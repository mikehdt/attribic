"""
HuggingFace transformers captioning provider.

Loads a vision-language model via `transformers` + PyTorch on CUDA and runs
inference in streaming mode so cancellation can interrupt within a token or two.

Model lifecycle mirrors the llama-cpp provider:
- Lazily loaded on first caption request
- Cached between requests for the same model directory
- Released on unload() (frees GPU memory)

Loading strategy: fp16, device_map="cuda", no quantization. We explicitly
avoid bitsandbytes here — if a low-VRAM variant is needed it gets its own
model entry in the registry rather than a runtime toggle.

Loading progress surfacing: transformers emits a `Loading checkpoint shards`
tqdm bar while reading safetensors. We monkey-patch the tqdm used by
`transformers.utils.logging` during the load so each step invokes our
on_load_progress callback — giving the UI real per-shard updates instead of
a silent 15-30s spinner.

Known behaviour:
- First call blocks ~10-30s for model load. Subsequent calls reuse the cached
  instance as long as the same model_path keeps coming in.
- `cancel_check` is polled per streamed token and, via a StoppingCriteria,
  once per decoding step inside `generate` itself — so cancel aborts the
  generation rather than waiting out the remaining token budget. Windows
  Python can't interrupt a single forward pass, so cancel takes effect after
  the current step — usually <100ms on GPU.
- `cancel_check` is also polled between load stages, but a single
  `from_pretrained` call can't be interrupted.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import math
import os
import queue
import re
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any, Iterator, Optional

from captioning.image_prep import downscale_to_pixel_budget
from captioning.provider import (
    CancelCheck,
    CaptionCancelled,
    CaptioningProvider,
    LoadProgressCallback,
)

if TYPE_CHECKING:
    from models import VideoSamplingOptions

# File extensions that route through the video branch instead of PIL.
_VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".mkv", ".avi"}

# qwen-vl-utils' FRAME_FACTOR — sampled frame counts must be a multiple of
# this (it's the temporal merge stride the model uses). Hardcoded here
# because importing it crosses into the vision_process private surface.
_FRAME_FACTOR = 2

# Hard minimum frames: we must at least ceil to FRAME_FACTOR so a very
# short clip doesn't under-sample past what the model can process.
_MIN_FRAMES = 2

# How long the streamer consumer waits for the next token before looping to
# re-check cancellation and generation-thread liveness. This is a poll interval,
# not a deadline — a slow prefill just loops — so it exists purely to stop a
# silent `generate` from blocking the consumer (and the whole GPU queue) forever.
_STREAM_POLL_SECONDS = 0.5


def _ffprobe_duration(video_path: str) -> Optional[float]:
    """
    Return the duration of a video in seconds via ffprobe, or None if the
    probe fails. Intentionally never raises — video handling already has a
    deeper fallback path, and a missing duration isn't worth aborting the
    whole batch over.
    """
    try:
        proc = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                video_path,
            ],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        if proc.returncode != 0:
            print(
                f"[transformers_provider] ffprobe failed for {video_path}: "
                f"{proc.stderr.strip()}",
                file=sys.stderr,
            )
            return None
        parsed = json.loads(proc.stdout)
        duration_raw = parsed.get("format", {}).get("duration")
        if duration_raw is None:
            return None
        return float(duration_raw)
    except (subprocess.TimeoutExpired, json.JSONDecodeError, ValueError, OSError) as e:
        print(
            f"[transformers_provider] ffprobe probe failed for {video_path}: {e}",
            file=sys.stderr,
        )
        return None


def _extract_frames_ffmpeg(
    video_path: str,
    timestamps: list[float],
) -> list[Any]:
    """
    Extract frames at exact timestamps (seconds) via ffmpeg and decode them
    to PIL.Image. One ffmpeg invocation per timestamp — less efficient than
    a single filter_complex pipe but far simpler and the dominant cost is
    the model inference, not the frame extraction.

    We deliberately use ffmpeg (which is already a system dependency for
    poster-frame extraction) instead of a Python video reader library so
    the video path has zero Python-side video-decoding deps. This makes
    `uv sync --extra gpu` unchanged from the image-only path — the only
    system requirement is the already-documented ffmpeg install.

    Returns frames in the same order as timestamps. Raises RuntimeError
    on any extraction failure (the caller reports it as a per-asset error).
    """
    from PIL import Image
    import io as _io

    frames: list[Any] = []
    for ts in timestamps:
        # -ss before -i = fast seek on the container, accurate enough at
        # 1s granularity for sampling. -frames:v 1 grabs exactly one frame.
        # mjpeg stdout pipe: simple bytes→PIL path with no temp files.
        proc = subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-ss",
                f"{ts:.3f}",
                "-i",
                video_path,
                "-frames:v",
                "1",
                "-f",
                "image2",
                "-vcodec",
                "mjpeg",
                "-",
            ],
            capture_output=True,
            timeout=30,
            check=False,
        )
        if proc.returncode != 0 or not proc.stdout:
            raise RuntimeError(
                f"ffmpeg frame extraction failed at t={ts:.3f}s: "
                f"{proc.stderr.decode('utf-8', errors='replace')[-300:]}"
            )
        frames.append(Image.open(_io.BytesIO(proc.stdout)).convert("RGB"))
    return frames


def _plan_video_sampling(
    duration_sec: Optional[float],
    frame_budget: int,
    max_fps: float,
) -> tuple[int, list[float]]:
    """
    Given a clip duration, a frame budget, and a max fps ceiling, decide
    how many frames to sample and at which timestamps (seconds from start).

    Logic mirrors qwen-vl-utils' smart_nframes:
    - n_frames = floor(min(duration * max_fps, frame_budget))
    - Rounded down to a multiple of FRAME_FACTOR (model stride)
    - Clamped to at least _MIN_FRAMES
    - If duration is unknown (probe failed), sample exactly frame_budget
      frames at uniform t=0..inf assuming 1-second steps as a fallback —
      this won't match reality but at least keeps the batch moving.

    Timestamps are uniformly spread; the first frame lands slightly after
    t=0 and the last slightly before t=duration so we don't try to read
    past the end.
    """
    if duration_sec is None or duration_sec <= 0:
        n = max(_MIN_FRAMES, (frame_budget // _FRAME_FACTOR) * _FRAME_FACTOR)
        return n, [float(i) for i in range(n)]

    # Raw upper bound from fps ceiling, then clamp to budget.
    raw_n = math.floor(duration_sec * max_fps)
    n = min(raw_n, frame_budget)
    n = max(n, _MIN_FRAMES)
    # Round down to FRAME_FACTOR multiple.
    n = max(_MIN_FRAMES, (n // _FRAME_FACTOR) * _FRAME_FACTOR)

    if n == 1:
        return 1, [duration_sec * 0.1]

    # Uniform spacing: leave a 5% margin at each end so a rounding error
    # doesn't land the last frame past the real clip end.
    margin = 0.05 * duration_sec
    usable = max(0.0, duration_sec - 2 * margin)
    if usable <= 0 or n <= 1:
        timestamps = [margin for _ in range(n)]
    else:
        step = usable / (n - 1)
        timestamps = [margin + i * step for i in range(n)]
    return n, timestamps


# Match tqdm's rendered progress line, e.g.
#   "Loading checkpoint shards:  50%|#####     | 1/2 [00:01<00:01,  1.76s/it]"
# Captures: description, current, total. We don't parse the percent because
# tqdm writes partial redraws with \r and we'd rather key on the step counter.
_TQDM_LINE_RE = re.compile(
    r"(?P<desc>[^\r\n:]+?):\s*\d+%\|[^|]*\|\s*(?P<cur>\d+)/(?P<tot>\d+)"
)


class _TqdmStderrHook:
    """
    Wraps sys.stderr so tqdm progress lines flow through a progress callback.

    tqdm writes its bars to stderr with \\r carriage returns for in-place
    updates. We pass writes through to the real stderr unchanged (so the
    terminal still shows the live bar) and additionally scan each write for
    a tqdm-formatted progress line — when we find one we fire our callback.

    This is version-independent: it works with whichever tqdm transformers
    happens to use, as long as the output format matches the regex. If the
    regex ever stops matching we just stop sending per-shard updates — the
    load itself still succeeds, and the pre/post messages around it still
    fire to keep the UI alive.
    """

    def __init__(
        self,
        original: Any,
        on_load_progress: LoadProgressCallback,
    ) -> None:
        self._original = original
        self._callback = on_load_progress
        self._last_key: Optional[tuple[str, int, int]] = None
        self._last_time = 0.0

    def write(self, data: Any) -> int:
        try:
            written = self._original.write(data)
        except Exception:
            written = 0

        if not isinstance(data, str):
            return written

        # tqdm flushes the same line multiple times with \r. Split on both
        # \r and \n so we see the latest state rather than the accumulated one.
        for chunk in re.split(r"[\r\n]", data):
            if not chunk:
                continue
            match = _TQDM_LINE_RE.search(chunk)
            if not match:
                continue
            desc = match.group("desc").strip() or "Loading model"
            current = int(match.group("cur"))
            total = int(match.group("tot"))
            key = (desc, current, total)
            if key == self._last_key:
                continue
            # Rate-limit broadcasts so rapid tqdm updates don't flood the
            # WebSocket. One update per 100ms is plenty for a ~2s shard load.
            now = time.monotonic()
            if now - self._last_time < 0.1 and current != total:
                continue
            self._last_key = key
            self._last_time = now
            try:
                self._callback(desc, current, total)
            except Exception:
                # Never let a broken callback break the load.
                pass

        return written

    def flush(self) -> None:
        try:
            self._original.flush()
        except Exception:
            pass

    def __getattr__(self, name: str) -> Any:
        # Forward anything else (isatty, fileno, encoding, ...) to the
        # underlying stream so libraries that probe stderr still work.
        return getattr(self._original, name)


# The stderr swap below is process-wide, so only one hook may be installed at
# a time. Benign today (one caption worker), but a second worker or a
# multi-GPU split would otherwise have two loads fighting over sys.stderr.
_stderr_hook_lock = threading.Lock()


@contextlib.contextmanager
def _broadcast_tqdm(
    on_load_progress: Optional[LoadProgressCallback],
) -> Iterator[None]:
    """
    During the blocking `from_pretrained` call, wrap sys.stderr so tqdm
    progress lines get forwarded to `on_load_progress`. No monkey-patching
    of transformers or huggingface_hub internals — we just observe the
    bytes tqdm writes.

    Concurrent loads yield unhooked rather than stealing the active hook's
    callback: losing load-progress granularity beats reporting one batch's
    shard counts to another batch's client, or restoring a foreign stream.
    """
    if on_load_progress is None:
        yield
        return

    if not _stderr_hook_lock.acquire(blocking=False):
        yield
        return

    original_stderr = sys.stderr
    hook = _TqdmStderrHook(original_stderr, on_load_progress)
    sys.stderr = hook  # type: ignore[assignment]
    try:
        yield
    finally:
        # Only unwind our own swap — if something nested a further hook on top
        # and hasn't unwound yet, clobbering it would lose their original.
        if sys.stderr is hook:
            sys.stderr = original_stderr
        _stderr_hook_lock.release()


def _cancel_stopping_criteria(cancel_check: Optional[CancelCheck]) -> Any:
    """
    Build a StoppingCriteriaList that ends generation when cancel_check flips.

    Without this, a cancel only stops the *consumer* — `generate` keeps
    decoding to the full token budget and the streamer drain blocks until it
    finishes, which on a sysmem-fallback run is minutes.
    """
    if cancel_check is None:
        return None

    import torch
    from transformers import StoppingCriteria, StoppingCriteriaList

    class _CancelCriteria(StoppingCriteria):
        def __call__(self, input_ids: Any, scores: Any, **kwargs: Any) -> Any:
            del scores, kwargs
            return torch.full(
                (input_ids.shape[0],),
                bool(cancel_check()),
                device=input_ids.device,
                dtype=torch.bool,
            )

    return StoppingCriteriaList([_CancelCriteria()])


class TransformersCaptioningProvider(CaptioningProvider):
    """Real VLM captioning via HuggingFace transformers + PyTorch CUDA."""

    def __init__(self) -> None:
        self._model: Optional[Any] = None
        self._processor: Optional[Any] = None
        self._loaded_model_path: Optional[str] = None
        # A generation thread that outlived its join timeout. It still holds a
        # reference to self._model, so loading or unloading while it runs would
        # free the model out from under an in-flight forward pass.
        self._orphaned_thread: Optional[threading.Thread] = None
        # Serialise all torch operations behind an async lock — the model is
        # not safe for concurrent forward passes, and cheaply queueing requests
        # is fine given batches are sequential anyway.
        self._lock = asyncio.Lock()

    def _assert_no_orphaned_generation(self) -> None:
        """Guard model lifecycle changes against a stuck generation thread."""
        thread = self._orphaned_thread
        if thread is None:
            return
        if not thread.is_alive():
            self._orphaned_thread = None
            return
        raise RuntimeError(
            "A previous generation is still running after its join timeout and "
            "still holds the loaded model; refusing to load or unload it. "
            "Restart the sidecar to recover."
        )

    def _make_streamer(self) -> Any:
        """Token streamer for both the image and video generation paths."""
        from transformers import TextIteratorStreamer

        assert self._processor is not None
        return TextIteratorStreamer(
            self._processor.tokenizer,
            skip_prompt=True,
            skip_special_tokens=True,
            timeout=_STREAM_POLL_SECONDS,
        )

    def _stream_generation(
        self,
        streamer: Any,
        generation_kwargs: dict[str, Any],
        cancel_check: Optional[CancelCheck],
        join_timeout: float,
    ) -> str:
        """
        Run `generate` on a worker thread and consume its streamed output.

        Shared by the image and video paths. Raises CaptionCancelled when
        cancel_check flips, and re-raises whatever `generate` raised otherwise
        (the batch manager records it as a per-image error).
        """
        import torch

        model = self._model
        assert model is not None
        generation_error: list[BaseException] = []

        def run_generation() -> None:
            try:
                model.generate(**generation_kwargs)
            except BaseException as err:  # noqa: BLE001 — re-raised in the consumer
                generation_error.append(err)
            finally:
                # Without this, a `generate` that dies before emitting its end
                # sentinel (CUDA OOM being the realistic case) leaves the
                # consumer blocked on the streamer queue forever, which wedges
                # the batch and the whole GPU queue behind it.
                try:
                    streamer.end()
                except Exception:
                    pass

        gen_thread = threading.Thread(target=run_generation, daemon=True)
        gen_thread.start()

        pieces: list[str] = []
        cancelled = False
        iterator = iter(streamer)
        try:
            while True:
                if cancel_check is not None and cancel_check():
                    cancelled = True
                    break
                try:
                    chunk = next(iterator)
                except StopIteration:
                    break
                except queue.Empty:
                    # No token this interval. Loop to re-poll cancellation, and
                    # bail if the generation thread died without ending the
                    # stream — otherwise we'd wait on a queue nobody will fill.
                    if not gen_thread.is_alive():
                        break
                    continue
                if chunk:
                    pieces.append(chunk)
        finally:
            # No draining on cancel: TextIteratorStreamer's queue is unbounded,
            # so the generation thread never blocks pushing into it — and a
            # drain loop here would block on the same queue instead of letting
            # the join timeout below bound our wait. The stopping criterion is
            # what actually ends generate promptly.
            gen_thread.join(timeout=join_timeout)
            if gen_thread.is_alive():
                self._orphaned_thread = gen_thread
                print(
                    "[transformers_provider] generation thread still alive after "
                    f"{join_timeout}s join; leaving it orphaned. The model stays "
                    "pinned until it exits — captioning will refuse to load or "
                    "unload until then.",
                    file=sys.stderr,
                )
            try:
                torch.cuda.empty_cache()
            except Exception:
                pass

        if cancelled:
            raise CaptionCancelled("cancelled mid-inference")
        if generation_error:
            failure = generation_error[0]
            if isinstance(failure, Exception):
                raise failure
            # A BaseException that isn't an Exception (SystemExit, CancelledError)
            # would sail past the batch manager's per-image handler and take the
            # queue worker down with it.
            raise RuntimeError(f"generation thread died: {failure!r}")

        return "".join(pieces).strip()

    def _load_model(
        self,
        model_path: str,
        on_load_progress: Optional[LoadProgressCallback] = None,
        cancel_check: Optional[CancelCheck] = None,
    ) -> None:
        """Load the model and processor. Blocking; runs in an executor."""
        # Imports inside the function so the sidecar boots cleanly even when
        # the gpu extra isn't installed.
        import torch
        from transformers import AutoModelForImageTextToText, AutoProcessor

        if self._model is not None and self._loaded_model_path == model_path:
            return

        self._assert_no_orphaned_generation()

        if cancel_check is not None and cancel_check():
            raise CaptionCancelled("cancelled before model load")

        # Release any previous instance before loading the next.
        if self._model is not None:
            try:
                del self._model
            except Exception:
                pass
            self._model = None
            self._processor = None
            try:
                torch.cuda.empty_cache()
            except Exception:
                pass

        if not torch.cuda.is_available():
            raise RuntimeError(
                "transformers VLM provider requires CUDA. "
                "Install the 'gpu' extra and ensure an NVIDIA GPU is present, "
                "or pick a GGUF (llama-cpp) model instead."
            )

        model_dir = Path(model_path)
        if not model_dir.exists():
            raise FileNotFoundError(
                f"Model directory not found: {model_path}. "
                "Download the model via the Model Manager first."
            )

        if on_load_progress is not None:
            on_load_progress("Reading tokenizer and processor", 0, 0)

        # Qwen2.5/3-VL ship with AutoProcessor + AutoModelForImageTextToText.
        # trust_remote_code=False is intentional — the HF canonical Qwen VL
        # classes have been upstreamed into transformers.
        processor = AutoProcessor.from_pretrained(
            str(model_dir),
            trust_remote_code=False,
        )

        if cancel_check is not None and cancel_check():
            raise CaptionCancelled("cancelled after processor load")

        if on_load_progress is not None:
            on_load_progress("Loading checkpoint shards", 0, 0)

        # Patch transformers' tqdm so shard loading pings our callback.
        with _broadcast_tqdm(on_load_progress):
            model = AutoModelForImageTextToText.from_pretrained(
                str(model_dir),
                torch_dtype=torch.float16,
                device_map="cuda",
                trust_remote_code=False,
            )
        model.eval()

        if on_load_progress is not None:
            on_load_progress("Model ready", 1, 1)

        self._model = model
        self._processor = processor
        self._loaded_model_path = model_path

        # Cache the load even when cancelled — the next batch reuses it.
        if cancel_check is not None and cancel_check():
            raise CaptionCancelled("cancelled during model load")

    def _generate_caption_blocking(
        self,
        image_path: str,
        prompt: str,
        max_tokens: int,
        temperature: float,
        cancel_check: Optional[CancelCheck],
    ) -> str:
        """Run streamed inference synchronously inside the lock."""
        from PIL import Image

        assert self._model is not None and self._processor is not None

        image = downscale_to_pixel_budget(Image.open(image_path).convert("RGB"))

        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": image},
                    {"type": "text", "text": prompt},
                ],
            }
        ]

        # Qwen VL processors accept the messages structure directly and
        # handle the chat template + image tokenisation in one call.
        inputs = self._processor.apply_chat_template(
            messages,
            add_generation_prompt=True,
            tokenize=True,
            return_dict=True,
            return_tensors="pt",
        ).to(self._model.device)

        streamer = self._make_streamer()

        generation_kwargs: dict[str, Any] = {
            **inputs,
            "streamer": streamer,
            "max_new_tokens": max_tokens,
            "do_sample": temperature > 0,
            "temperature": max(temperature, 1e-5),
            "pad_token_id": self._processor.tokenizer.eos_token_id,
        }
        stopping_criteria = _cancel_stopping_criteria(cancel_check)
        if stopping_criteria is not None:
            generation_kwargs["stopping_criteria"] = stopping_criteria

        # Generation runs on a background thread so we can iterate the streamer
        # and poll for cancellation in the calling thread.
        return self._stream_generation(
            streamer, generation_kwargs, cancel_check, join_timeout=60
        )

    def _generate_video_caption_blocking(
        self,
        video_path: str,
        prompt: str,
        max_tokens: int,
        temperature: float,
        cancel_check: Optional[CancelCheck],
        video_options: Optional["VideoSamplingOptions"],
    ) -> str:
        """
        Run streamed inference on a video file.

        Frame sampling is done entirely via ffmpeg + PIL, bypassing
        qwen-vl-utils' built-in video backends. This is a deliberate
        choice:

        - torchvision 0.26+ removed `torchvision.io.read_video`, which is
          what qwen-vl-utils tries first. Newer qwen-vl-utils releases
          expect `torchcodec`, older ones expect `decord`. Both are extra
          Python deps with their own compatibility pitfalls.
        - We already require ffmpeg on PATH for poster-frame extraction,
          so reusing it for video sampling adds zero new deps and
          guarantees the code path is insulated from upstream churn in
          the torchvision/torchcodec/decord ecosystem.
        - We get exact control over which timestamps to sample, which
          makes the "uniform coverage across clip duration" goal easy
          to express and debug.

        Once frames are in hand as PIL images, we hand them to
        qwen-vl-utils' frame-list branch (fetch_video's isinstance
        list/tuple path) by passing `"video": [frame, frame, ...]` in
        the message. That path skips all video IO and goes straight to
        per-frame preprocessing.
        """
        from qwen_vl_utils import process_vision_info

        assert self._model is not None and self._processor is not None

        # Defaults match the Pydantic model — used when the request didn't
        # include a video block at all (single-image API callers).
        frame_budget = video_options.frame_budget if video_options else 32
        max_fps = video_options.max_fps if video_options else 2.0
        max_pixels = video_options.max_pixels if video_options else 360 * 420

        # Duration → sampling plan → actual frames. Each step is defensive
        # about failure: probe failure falls back to a fixed-step plan,
        # extraction failure bubbles up as a per-asset error.
        duration_sec = _ffprobe_duration(video_path)
        n_frames, timestamps = _plan_video_sampling(
            duration_sec, frame_budget, max_fps
        )
        print(
            f"[transformers_provider] video: {os.path.basename(video_path)} "
            f"duration={duration_sec} budget={frame_budget} max_fps={max_fps} "
            f"planned_frames={n_frames}",
            file=sys.stderr,
        )

        if cancel_check is not None and cancel_check():
            raise CaptionCancelled("cancelled before frame extraction")

        frames = _extract_frames_ffmpeg(video_path, timestamps)

        if cancel_check is not None and cancel_check():
            raise CaptionCancelled("cancelled after frame extraction")

        # Hand frames to qwen-vl-utils as a list. The `sample_fps` hint
        # tells the processor the effective sampling rate so temporal
        # embeddings are right. `raw_fps` is also picked up for metadata.
        effective_fps = (
            len(frames) / duration_sec if duration_sec and duration_sec > 0 else max_fps
        )
        video_content: dict[str, Any] = {
            "type": "video",
            "video": frames,
            "max_pixels": max_pixels,
            "sample_fps": effective_fps,
            "raw_fps": effective_fps,
        }

        messages = [
            {
                "role": "user",
                "content": [
                    video_content,
                    {"type": "text", "text": prompt},
                ],
            }
        ]

        # Render the chat template to text. We use tokenize=False because
        # the processor needs the rendered text *and* the video tensor in
        # the same call, which is a different shape than the image path.
        text = self._processor.apply_chat_template(
            messages,
            add_generation_prompt=True,
            tokenize=False,
        )

        # process_vision_info returns (image_inputs, video_inputs, video_kwargs).
        # We opt into return_video_metadata=True so the per-video metadata
        # (fps, frame indices, total frame count) rides through to the
        # processor. Without it, Qwen3VLProcessor can't infer frame
        # timestamps and falls back to a hardcoded fps=24, which produces
        # correct-looking captions but with slightly wrong temporal
        # embeddings (the model thinks it's seeing 24fps footage when we
        # actually sampled at a much lower rate).
        #
        # With return_video_metadata=True, `video_inputs` is a list of
        # (tensor, metadata_dict) tuples. Qwen3VLProcessor expects these
        # split apart: `videos` as a plain list of tensors, and
        # `video_metadata` as a parallel list passed through `videos_kwargs`.
        # We unpack here to match that contract — otherwise the upstream
        # make_batched_videos() doesn't recognise the tuple shape and
        # drops the entries, leading to an empty-list IndexError.
        image_inputs, video_inputs, video_kwargs = process_vision_info(
            messages,
            return_video_kwargs=True,
            return_video_metadata=True,
        )

        video_tensors: Optional[list[Any]] = None
        video_metadata: Optional[list[Any]] = None
        if video_inputs:
            video_tensors = []
            video_metadata = []
            for entry in video_inputs:
                if isinstance(entry, tuple) and len(entry) == 2:
                    tensor, meta = entry
                else:
                    # Shouldn't happen with return_video_metadata=True, but
                    # handle it gracefully so an unexpected shape surfaces
                    # a clearer error than "list index out of range".
                    tensor, meta = entry, None
                video_tensors.append(tensor)
                video_metadata.append(meta)

        processor_kwargs: dict[str, Any] = {**(video_kwargs or {})}
        if video_metadata is not None:
            processor_kwargs["video_metadata"] = video_metadata

        inputs = self._processor(
            text=[text],
            images=image_inputs,
            videos=video_tensors,
            return_tensors="pt",
            **processor_kwargs,
        ).to(self._model.device)

        # Log what actually landed in the model tensor so VRAM/quality
        # issues are debuggable from sidecar output alone.
        try:
            actual_frames = (
                video_tensors[0].shape[0] if video_tensors else 0
            )  # T dim of (T, C, H, W)
            print(
                f"[transformers_provider] video tensor: "
                f"actual_frames={actual_frames} max_pixels={max_pixels} "
                f"effective_fps={effective_fps:.2f}",
                file=sys.stderr,
            )
        except Exception as e:
            print(
                f"[transformers_provider] video tensor log failed: {e}",
                file=sys.stderr,
            )

        streamer = self._make_streamer()

        generation_kwargs: dict[str, Any] = {
            **inputs,
            "streamer": streamer,
            "max_new_tokens": max_tokens,
            "do_sample": temperature > 0,
            "temperature": max(temperature, 1e-5),
            "pad_token_id": self._processor.tokenizer.eos_token_id,
        }
        stopping_criteria = _cancel_stopping_criteria(cancel_check)
        if stopping_criteria is not None:
            generation_kwargs["stopping_criteria"] = stopping_criteria

        return self._stream_generation(
            streamer, generation_kwargs, cancel_check, join_timeout=120
        )

    async def prepare(
        self,
        model_path: str,
        on_load_progress: Optional[LoadProgressCallback] = None,
        cancel_check: Optional[CancelCheck] = None,
    ) -> None:
        """Pre-load the model so the first caption isn't gated on a cold load."""
        async with self._lock:
            if self._model is None or self._loaded_model_path != model_path:
                await asyncio.get_event_loop().run_in_executor(
                    None,
                    self._load_model,
                    model_path,
                    on_load_progress,
                    cancel_check,
                )

    async def caption_image(
        self,
        image_path: str,
        model_path: str,
        prompt: str,
        max_tokens: int = 512,
        temperature: float = 0.7,
        cancel_check: Optional[CancelCheck] = None,
        on_load_progress: Optional[LoadProgressCallback] = None,
        video_options: Optional["VideoSamplingOptions"] = None,
    ) -> str:
        async with self._lock:
            # Normally the batch manager calls `prepare` first, but we also
            # keep a lazy-load path so single-image callers still work.
            if self._model is None or self._loaded_model_path != model_path:
                await asyncio.get_event_loop().run_in_executor(
                    None,
                    self._load_model,
                    model_path,
                    on_load_progress,
                    cancel_check,
                )

            ext = os.path.splitext(image_path)[1].lower()
            is_video = ext in _VIDEO_EXTENSIONS

            # Run inference in a thread so the event loop stays free to push
            # WebSocket progress updates to connected clients.
            if is_video:
                return await asyncio.get_event_loop().run_in_executor(
                    None,
                    self._generate_video_caption_blocking,
                    image_path,
                    prompt,
                    max_tokens,
                    temperature,
                    cancel_check,
                    video_options,
                )
            return await asyncio.get_event_loop().run_in_executor(
                None,
                self._generate_caption_blocking,
                image_path,
                prompt,
                max_tokens,
                temperature,
                cancel_check,
            )

    async def unload(self) -> None:
        async with self._lock:
            self._assert_no_orphaned_generation()
            if self._model is not None:
                try:
                    del self._model
                    del self._processor
                except Exception:
                    pass
                self._model = None
                self._processor = None
                self._loaded_model_path = None
                try:
                    import torch

                    torch.cuda.empty_cache()
                except Exception:
                    pass
