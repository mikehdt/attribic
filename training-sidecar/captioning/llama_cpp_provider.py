"""
llama-cpp-python captioning provider.

Loads a multimodal GGUF model (LLM weights + mmproj vision projector)
and runs image captioning via the chat completion API.

Model lifecycle:
- Lazily loaded on first caption request
- Cached between requests for the same model path
- Released on unload() (frees CPU/GPU memory)

Currently targets Qwen2.5/3-VL via Qwen25VLChatHandler. Other model
families (Gemma, LLaVA, etc.) would need their own chat handler;
see llama_cpp.llama_chat_format for the available options.

Known quality tunable (not yet exposed by llama-cpp-python):
  Qwen-VL models recommend --image-min-tokens 1024 for best grounding
  accuracy. The CLI flag works; the Python API doesn't expose it as of
  0.3.19. Revisit once upstream adds the parameter. For captioning
  (vs grounding/detection tasks), the default behaviour is acceptable.
  Tracking: https://github.com/ggml-org/llama.cpp/issues/16842
"""

from __future__ import annotations

import asyncio
import base64
import io
import os
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Any, Optional

if TYPE_CHECKING:
    from models import VideoSamplingOptions

from captioning.provider import (
    CancelCheck,
    CaptionCancelled,
    CaptioningProvider,
    LoadProgressCallback,
)


class LlamaCppCaptioningProvider(CaptioningProvider):
    """Real VLM captioning via llama-cpp-python."""

    def __init__(self) -> None:
        self._llm: Optional[Any] = None
        self._loaded_model_path: Optional[str] = None
        self._loaded_mmproj_path: Optional[str] = None
        # All llama-cpp operations are blocking — serialise them behind a lock
        self._lock = asyncio.Lock()

    def _resolve_mmproj_path(self, model_path: str) -> str:
        """
        Look for a matching mmproj GGUF file next to the main model.
        Convention: {base}.mmproj-{quant}.gguf
        """
        model_dir = Path(model_path).parent
        candidates = sorted(model_dir.glob("*mmproj*.gguf"))
        if not candidates:
            raise FileNotFoundError(
                f"No mmproj file found next to {model_path}. "
                "Vision models need a separate mmproj GGUF for image encoding."
            )
        # Prefer Q8_0 over f16 (smaller, comparable quality)
        q8 = [c for c in candidates if "Q8" in c.name or "q8" in c.name]
        if q8:
            return str(q8[0])
        return str(candidates[0])

    def _load_model(
        self,
        model_path: str,
        cancel_check: Optional[CancelCheck] = None,
    ) -> None:
        """Load the Llama instance and its chat handler. Blocking.

        `cancel_check` is polled between the two loads (vision projector, then
        the GGUF itself); neither call is interruptible on its own, so a cancel
        lands at the next boundary rather than immediately.
        """
        # Import here to avoid startup cost if captioning is never used
        from llama_cpp import Llama
        from llama_cpp.llama_chat_format import Qwen25VLChatHandler

        if (
            self._llm is not None
            and self._loaded_model_path == model_path
        ):
            return

        if cancel_check is not None and cancel_check():
            raise CaptionCancelled("cancelled before model load")

        # Release any previous instance
        if self._llm is not None:
            try:
                del self._llm
            except Exception:
                pass
            self._llm = None

        mmproj_path = self._resolve_mmproj_path(model_path)

        chat_handler = Qwen25VLChatHandler(clip_model_path=mmproj_path)

        if cancel_check is not None and cancel_check():
            raise CaptionCancelled("cancelled after chat-handler load")

        self._llm = Llama(
            model_path=model_path,
            chat_handler=chat_handler,
            n_ctx=4096,
            n_gpu_layers=-1,  # offload all layers; harmless on CPU-only builds
            verbose=False,
            logits_all=False,
        )
        self._loaded_model_path = model_path
        self._loaded_mmproj_path = mmproj_path

        # Keep the loaded model cached even when cancelled — the next batch
        # reuses it rather than paying the load again.
        if cancel_check is not None and cancel_check():
            raise CaptionCancelled("cancelled during model load")

    def _downscaled_jpeg_bytes(self, image_path: str) -> Optional[bytes]:
        """
        Re-encode an oversized image down to the pixel budget as JPEG.

        Returns None when the image is already within budget (send the
        original bytes — no re-encode, no generation loss) or when Pillow
        isn't installed. Pillow only ships in the "gpu" extra, so a
        `uv sync --extra vlm` install runs this provider without it; there
        we accept the original size rather than fail the caption.
        """
        try:
            from PIL import Image

            from captioning.image_prep import (
                MAX_IMAGE_PIXELS,
                downscale_to_pixel_budget,
            )
        except ImportError:
            print(
                "[llama_cpp_provider] Pillow not installed - sending image at "
                "full size. Large images may exhaust memory; install the "
                "'gpu' extra to enable downscaling.",
                file=sys.stderr,
            )
            return None

        with Image.open(image_path) as opened:
            width, height = opened.size
            if width * height <= MAX_IMAGE_PIXELS:
                return None

            # JPEG can't hold alpha, and the model doesn't use it regardless.
            resized = downscale_to_pixel_budget(opened.convert("RGB"))

        buffer = io.BytesIO()
        resized.save(buffer, format="JPEG", quality=90)
        return buffer.getvalue()

    def _image_to_data_uri(self, image_path: str) -> str:
        """Encode an image file as a base64 data URI for the chat handler."""
        downscaled = self._downscaled_jpeg_bytes(image_path)
        if downscaled is not None:
            encoded = base64.b64encode(downscaled).decode("ascii")
            return f"data:image/jpeg;base64,{encoded}"

        ext = os.path.splitext(image_path)[1].lower().lstrip(".")
        if ext in ("jpg", "jpeg"):
            mime = "image/jpeg"
        elif ext == "png":
            mime = "image/png"
        elif ext == "webp":
            mime = "image/webp"
        else:
            mime = "image/jpeg"  # best-effort fallback

        with open(image_path, "rb") as f:
            encoded = base64.b64encode(f.read()).decode("ascii")
        return f"data:{mime};base64,{encoded}"

    def _generate_caption_blocking(
        self,
        image_path: str,
        prompt: str,
        max_tokens: int,
        temperature: float,
        cancel_check: Optional[CancelCheck],
    ) -> str:
        """
        Run inference synchronously in streaming mode.

        Streaming lets us poll `cancel_check` between tokens and abort
        mid-generation — otherwise a single image can tie up the worker
        for minutes on CPU with no way out.
        """
        assert self._llm is not None

        data_uri = self._image_to_data_uri(image_path)

        stream = self._llm.create_chat_completion(
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": data_uri}},
                        {"type": "text", "text": prompt},
                    ],
                }
            ],
            max_tokens=max_tokens,
            temperature=temperature,
            stream=True,
        )

        pieces: list[str] = []
        try:
            for chunk in stream:
                if cancel_check is not None and cancel_check():
                    raise CaptionCancelled("cancelled mid-inference")

                choices = chunk.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                content = delta.get("content")
                if isinstance(content, str) and content:
                    pieces.append(content)
        finally:
            # Ensure the underlying generator is closed so llama.cpp can
            # release its sampler/context state promptly on cancel.
            close = getattr(stream, "close", None)
            if callable(close):
                try:
                    close()
                except Exception:
                    pass

        return "".join(pieces).strip()

    async def _ensure_loaded(
        self,
        model_path: str,
        on_load_progress: Optional[LoadProgressCallback],
        cancel_check: Optional[CancelCheck] = None,
    ) -> None:
        """Blocking load, idempotent. Emits a single status message around it."""
        if self._llm is not None and self._loaded_model_path == model_path:
            return
        if cancel_check is not None and cancel_check():
            raise CaptionCancelled("cancelled before model load")
        if on_load_progress is not None:
            on_load_progress("Loading GGUF into RAM", 0, 0)
        await asyncio.get_event_loop().run_in_executor(
            None, self._load_model, model_path, cancel_check
        )
        if on_load_progress is not None:
            on_load_progress("Model loaded", 1, 1)

    async def prepare(
        self,
        model_path: str,
        on_load_progress: Optional[LoadProgressCallback] = None,
        cancel_check: Optional[CancelCheck] = None,
    ) -> None:
        """Pre-load the GGUF so the first caption isn't gated on a cold load."""
        async with self._lock:
            await self._ensure_loaded(model_path, on_load_progress, cancel_check)

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
        del video_options  # llama-cpp path is image-only
        # Reject video paths up front. The Node side normally substitutes
        # a poster frame for non-video-capable models, so a .mp4 reaching
        # this provider is an upstream wiring bug — surface it loudly
        # rather than crashing later inside PIL.
        ext = os.path.splitext(image_path)[1].lower()
        if ext in {".mp4", ".webm", ".mov", ".mkv", ".avi"}:
            raise RuntimeError(
                f"llama-cpp provider received a video file ({ext}); "
                "this runtime cannot read video frames. Choose a "
                "transformers (GPU) model for native video captioning."
            )
        async with self._lock:
            # Normally the batch manager calls `prepare` first, but we also
            # keep a lazy-load path so single-image callers still work.
            await self._ensure_loaded(model_path, on_load_progress, cancel_check)

            # Run inference in a thread so we don't block the event loop.
            # This lets WebSocket progress broadcasts flow during generation.
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
            if self._llm is not None:
                try:
                    del self._llm
                except Exception:
                    pass
                self._llm = None
                self._loaded_model_path = None
                self._loaded_mmproj_path = None
