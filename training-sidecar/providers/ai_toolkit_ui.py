"""ai-toolkit training provider that drives the UI's HTTP API.

Instead of spawning `run.py` directly and scraping stderr (see
`ai_toolkit.py` for that approach — kept around as a template for the
future Kohya / Musubi providers), this provider talks to ai-toolkit's
own web server. Benefits:

  * structured progress (step / status / info / speed_string) via
    `GET /api/jobs?id=...` — no tqdm regex
  * graceful cancel via `GET /api/jobs/<id>/stop`
  * loss / log / sample-image history surfaced by ai-toolkit's API
  * insulated from their SQLite schema — the HTTP API is the contract

Requires the ai-toolkit UI server to be running, managed by
`ai_toolkit_server.AiToolkitServer`.
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Optional

import httpx

from ai_toolkit_server import AiToolkitServer
from models import JobProgress, JobStatus, StartJobRequest
from providers.ai_toolkit import (
    SUPPORTED_MODELS,
    _find_model,
    _first_resolution,
    _resolve_save_every_steps,
)
from providers.base import TrainingProvider

POLL_INTERVAL_SECONDS = 1.0
TERMINAL_STATUSES = {"completed", "stopped", "error"}

# After ai-toolkit flips a job to a terminal status, we wait for its
# subprocess PID to actually exit before releasing the GPU back to the
# queue. ai-toolkit's DiffusionTrainer.done_hook updates status BEFORE
# running wait_for_all_async / thread_pool.shutdown(wait=True), so the
# Python process can still be finalising (saving, sampling, async flushes)
# for a while after the DB says "completed". Handing the GPU to the next
# queued job during that window puts two training processes on the same
# GPU.
PID_EXIT_TIMEOUT_SECONDS = 180.0
PID_EXIT_POLL_INTERVAL = 0.5
# Fallback if the row has no pid (shouldn't happen in normal operation, but
# we don't want to hang the worker indefinitely on a weird DB state).
PID_UNKNOWN_SETTLE_SECONDS = 5.0


def _scan_checkpoints(output_path: str, output_name: str) -> set[str]:
    """Return the set of checkpoint safetensors written for this job so far.

    ai-toolkit's jobs API (`GET /api/jobs?id=`) surfaces only status / step /
    info / speed_string / pid — no save event or checkpoint list — so we watch
    the output directory instead. ai-toolkit writes intermediate LoRAs as
    `<name>_<step>.safetensors` (plus a final `<name>.safetensors`) flat under
    `<training_folder>/<name>/` (BaseTrainProcess sets
    `save_root = join(training_folder, name)`), so scan that subfolder — the
    job config's `name` is `output_name`, and `training_folder` is
    `output_path`.

    We iterate that directory non-recursively (so the ever-growing `samples/`
    subfolder isn't re-walked every second) and match with plain string ops
    rather than a glob — `output_name` is user-controlled free text and can
    contain glob metacharacters (e.g. `[v2]`) that would break `rglob`.
    """
    root = Path(output_path) / output_name
    if not root.exists():
        return set()
    try:
        return {
            str(p)
            for p in root.iterdir()
            if p.is_file()
            and p.name.startswith(output_name)
            and p.name.endswith(".safetensors")
        }
    except OSError:
        return set()


def _step_from_checkpoint_name(
    filename: str, output_name: str, fallback_step: int
) -> int:
    """Parse the training step encoded in a checkpoint filename.

    ai-toolkit writes intermediate saves as `<output_name>_<step>.safetensors`
    and a final save as `<output_name>.safetensors` (no step suffix). Returns
    the parsed step for intermediate saves, or `fallback_step` for the
    suffix-less final save — and for any name that doesn't parse cleanly, so an
    unexpected layout degrades to the polled step instead of crashing.
    """
    stem = filename
    if stem.endswith(".safetensors"):
        stem = stem[: -len(".safetensors")]
    if stem.startswith(output_name):
        stem = stem[len(output_name) :]
    # Intermediate saves separate the step with `_` (defensively also `-`).
    stem = stem.lstrip("_-")
    # Extract a trailing run of digits; fall back when there isn't one (the
    # no-suffix final save leaves stem empty).
    trailing = ""
    for ch in reversed(stem):
        if ch.isdigit():
            trailing = ch + trailing
        else:
            break
    return int(trailing) if trailing else fallback_step


def _steps_for_new_checkpoints(
    new_files: set[str], output_name: str, fallback_step: int
) -> list[int]:
    """Map newly-appeared checkpoint paths to their training steps.

    One entry per file so multiple saves that land within a single poll window
    are each recorded (the manager dedupes by step). Intermediate saves use the
    step parsed from their filename; the suffix-less final save (and any
    unparseable name) falls back to `fallback_step`.
    """
    return [
        _step_from_checkpoint_name(Path(p).name, output_name, fallback_step)
        for p in new_files
    ]


def _pid_alive(pid: int) -> bool:
    """Cross-platform: is a process with this PID currently running?"""
    if pid <= 0:
        return False
    if sys.platform == "win32":
        import ctypes

        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        STILL_ACTIVE = 259
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION, False, pid
        )
        if not handle:
            # Process gone (or access denied — treat the same way; we can't
            # distinguish, and "we can't see it" is as good as "it's gone"
            # for our purposes of deciding it's safe to release the GPU).
            return False
        try:
            exit_code = ctypes.c_ulong()
            ok = kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code))
            return ok != 0 and exit_code.value == STILL_ACTIVE
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        return True
    except (ProcessLookupError, PermissionError):
        return False


async def _wait_for_pid_exit(
    pid: Optional[int],
    timeout: float = PID_EXIT_TIMEOUT_SECONDS,
    poll_interval: float = PID_EXIT_POLL_INTERVAL,
) -> bool:
    """Wait for `pid` to exit. Returns True if it did, False on timeout.

    Falls back to a short settle delay when pid is missing/invalid.
    """
    if pid is None or pid <= 0:
        await asyncio.sleep(PID_UNKNOWN_SETTLE_SECONDS)
        return True
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        if not _pid_alive(pid):
            return True
        await asyncio.sleep(poll_interval)
    return False


class AiToolkitUiProvider(TrainingProvider):
    """ai-toolkit provider that uses the UI server's HTTP API."""

    def __init__(self, toolkit_path: str, server: AiToolkitServer):
        self._toolkit_path = Path(toolkit_path)
        self._server = server
        # Tracked so cancel_training can stop the in-flight job without
        # the caller having to thread the id back through.
        self._current_job_id: Optional[str] = None

    async def validate_environment(self) -> tuple[bool, Optional[str]]:
        ui_dir = self._toolkit_path / "ui"
        if not ui_dir.exists():
            return False, f"ai-toolkit UI not found at {ui_dir}"
        return True, None

    async def generate_config(
        self, request: StartJobRequest, config_dir: str
    ) -> str:
        """Return a stub path. The real config is sent to the API in
        start_training as JSON; ai-toolkit's worker writes it to disk
        itself. We don't need to materialise a YAML file."""
        return ""

    async def start_training(
        self, request: StartJobRequest, config_path: str, gpu_id: int = 0
    ) -> AsyncGenerator[JobProgress, None]:
        # The local job_id used by the parent JobManager is opaque to us;
        # ai-toolkit assigns its own id when we POST /api/jobs. We use
        # the parent id as the human-readable name and remember the
        # ai-toolkit id for polling/cancel.
        local_job_id = request.output_name

        # Accumulate a log tail as we progress through setup so the UI
        # can surface what the sidecar is actually doing during the
        # pre-training window (which can take a minute+ the first time
        # ai-toolkit's server cold-starts).
        log_tail: list[str] = []

        def _emit(label: str) -> JobProgress:
            log_tail.append(label)
            return JobProgress(
                job_id=local_job_id,
                status=JobStatus.PREPARING,
                log_lines=log_tail[-50:],
            )

        yield _emit("Starting ai-toolkit server...")
        await self._server.ensure_running()
        yield _emit("ai-toolkit server ready")

        config_dict = _build_config_dict(request, gpu_id)
        # Unique name — ai-toolkit's `name` column is a unique key, so a
        # second run with the same output_name would 409. Append a short
        # suffix; the user-facing label still comes from request.output_name.
        unique_name = f"{request.output_name}-{uuid.uuid4().hex[:8]}"

        async with httpx.AsyncClient(
            base_url=self._server.base_url, timeout=30.0
        ) as client:
            yield _emit(f"Submitting job to ai-toolkit (gpu {gpu_id})...")
            # 1. Create the job row
            create_res = await client.post(
                "/api/jobs",
                json={
                    "name": unique_name,
                    "gpu_ids": str(gpu_id),
                    "job_config": config_dict,
                },
            )
            if create_res.status_code >= 400:
                raise RuntimeError(
                    f"ai-toolkit /api/jobs returned {create_res.status_code}: "
                    f"{create_res.text[:300]}"
                )
            created = create_res.json()
            aitk_id: str = created["id"]
            self._current_job_id = aitk_id

            yield _emit(f"Job created: {aitk_id}")

            # 2. Queue the job
            start_res = await client.get(f"/api/jobs/{aitk_id}/start")
            if start_res.status_code >= 400:
                raise RuntimeError(
                    f"ai-toolkit /api/jobs/{aitk_id}/start returned "
                    f"{start_res.status_code}: {start_res.text[:300]}"
                )

            # 3. Make sure the queue itself is running. ai-toolkit's Queue
            # rows have an `is_running` flag; if it's false the worker
            # ignores queued jobs forever ("Queue Stopped" in their UI).
            # /api/queue/<gpu_ids>/start flips it to true (or creates the
            # row already-running).
            queue_res = await client.get(f"/api/queue/{gpu_id}/start")
            if queue_res.status_code >= 400:
                raise RuntimeError(
                    f"ai-toolkit /api/queue/{gpu_id}/start returned "
                    f"{queue_res.status_code}: {queue_res.text[:300]}"
                )

            yield _emit("Waiting for worker to pick up job...")

            # 4. Poll the job row until terminal. We keep the log_tail we
            # already built up during setup so the UI doesn't lose context
            # when the polling phase starts.
            total_steps = int(request.hyperparameters.get("steps", 0)) or 0
            sample_paths: list[str] = []
            last_step = -1
            last_status_label = ""
            # Confirmed-save detection via output-dir watching (the jobs API
            # exposes no save events). Seed with whatever's already on disk so
            # a resumed run doesn't count pre-existing files as fresh saves.
            seen_checkpoints: set[str] = _scan_checkpoints(
                request.output_path, request.output_name
            )

            while True:
                await asyncio.sleep(POLL_INTERVAL_SECONDS)
                res = await client.get("/api/jobs", params={"id": aitk_id})
                if res.status_code != 200:
                    # Transient — keep polling.
                    continue
                row = res.json()
                if row is None:
                    # Job vanished (deleted out from under us).
                    yield JobProgress(
                        job_id=local_job_id,
                        status=JobStatus.FAILED,
                        error="ai-toolkit job row disappeared",
                    )
                    break

                aitk_status: str = row.get("status", "")
                step: int = row.get("step", 0) or 0
                info: str = row.get("info", "") or ""
                speed: str = row.get("speed_string", "") or ""

                if info and info != last_status_label:
                    log_tail.append(info)
                    del log_tail[:-50]
                    last_status_label = info

                if aitk_status in ("queued", "starting"):
                    yield JobProgress(
                        job_id=local_job_id,
                        status=JobStatus.PREPARING,
                        log_lines=log_tail[-50:],
                    )
                elif aitk_status == "running":
                    # Watch the output dir for newly-written checkpoints. Any
                    # new file since the last poll is a confirmed save at the
                    # current step; the manager dedupes by step.
                    newly_saved: list[int] = []
                    if step > 0:
                        current_files = _scan_checkpoints(
                            request.output_path, request.output_name
                        )
                        new_files = current_files - seen_checkpoints
                        if new_files:
                            # Attribute each new file to the step parsed from
                            # its own name — poll lag means `step` may have
                            # moved past the step the file was actually saved
                            # at, and several files can appear in one window.
                            newly_saved = _steps_for_new_checkpoints(
                                new_files, request.output_name, step
                            )
                            seen_checkpoints = current_files

                    if step != last_step or info != last_status_label or newly_saved:
                        last_step = step
                        # ai-toolkit's `step` updates only after training
                        # has begun. Until then, keep emitting PREPARING.
                        if step <= 0:
                            yield JobProgress(
                                job_id=local_job_id,
                                status=JobStatus.PREPARING,
                                log_lines=log_tail,
                            )
                        else:
                            loss, lr, eta = _parse_speed_string(speed)
                            yield JobProgress(
                                job_id=local_job_id,
                                status=JobStatus.TRAINING,
                                current_step=step,
                                total_steps=total_steps,
                                loss=loss,
                                learning_rate=lr,
                                eta_seconds=eta,
                                saved_checkpoints=newly_saved,
                                sample_image_paths=sample_paths,
                                log_lines=log_tail,
                            )
                elif aitk_status in TERMINAL_STATUSES:
                    final_status = (
                        JobStatus.COMPLETED
                        if aitk_status == "completed"
                        else JobStatus.CANCELLED
                        if aitk_status == "stopped"
                        else JobStatus.FAILED
                    )

                    # Wait for ai-toolkit's Python subprocess to actually exit
                    # before yielding terminal — the DB status flips before
                    # shutdown finishes (see PID_EXIT_* notes above). Until
                    # that process is gone, it may still be touching the GPU.
                    pid = row.get("pid")
                    if pid and _pid_alive(int(pid)):
                        log_tail.append("Finalizing...")
                        del log_tail[:-50]
                        # Keep the job appearing active in the UI while we
                        # wait, with a clearly distinct "Finalizing" log
                        # line so it doesn't look frozen.
                        yield JobProgress(
                            job_id=local_job_id,
                            status=JobStatus.TRAINING,
                            current_step=step,
                            total_steps=total_steps,
                            log_lines=log_tail,
                        )
                        exited = await _wait_for_pid_exit(int(pid))
                        if not exited:
                            print(
                                f"[ai-toolkit-ui] Warning: aitk job {aitk_id} "
                                f"pid {pid} did not exit within "
                                f"{PID_EXIT_TIMEOUT_SECONDS:.0f}s; releasing "
                                "GPU anyway"
                            )

                    # One last sweep before going terminal: ai-toolkit writes
                    # the final `<name>.safetensors` during finalisation, after
                    # the last "running" poll — without this the run always
                    # under-reports its save count by one.
                    final_saved: list[int] = []
                    current_files = _scan_checkpoints(
                        request.output_path, request.output_name
                    )
                    new_files = current_files - seen_checkpoints
                    if new_files:
                        # The final save has no step suffix; attribute it to
                        # total_steps when known (more reliable at completion
                        # than the last polled step), else the polled step.
                        fallback = total_steps if total_steps > 0 else step
                        final_saved = _steps_for_new_checkpoints(
                            new_files, request.output_name, fallback
                        )
                        seen_checkpoints = current_files

                    yield JobProgress(
                        job_id=local_job_id,
                        status=final_status,
                        current_step=step,
                        total_steps=total_steps,
                        saved_checkpoints=final_saved,
                        error=info if final_status == JobStatus.FAILED else None,
                        log_lines=log_tail,
                    )
                    break

            self._current_job_id = None

    async def cancel_training(self) -> None:
        if not self._current_job_id:
            return
        try:
            async with httpx.AsyncClient(
                base_url=self._server.base_url, timeout=10.0
            ) as client:
                await client.get(f"/api/jobs/{self._current_job_id}/stop")
        except httpx.HTTPError as err:
            print(f"[ai-toolkit-ui] cancel failed: {err}")

    def get_supported_models(self) -> list[dict]:
        return [
            {"id": m["id"], "name": m["name"], "architecture": m["architecture"]}
            for m in SUPPORTED_MODELS
        ]


# ---------------------------------------------------------------------------
# Config builder (mirrors providers/ai_toolkit.py but emits ui_trainer)
# ---------------------------------------------------------------------------


def _build_config_dict(request: StartJobRequest, gpu_id: int = 0) -> dict:
    """Build the ai-toolkit job_config dict — same shape as the YAML the
    CLI provider emits, but with `process[0].type = ui_trainer` so
    UITrainer is selected and writes step/info to the DB.

    ai-toolkit's worker injects `sqlite_db_path` itself before spawning,
    so we don't need to set that here.
    """
    model_def = _find_model(request.base_model)
    if model_def is None:
        raise ValueError(f"Unknown model: {request.base_model}")

    hp = request.hyperparameters
    defaults = model_def["train_defaults"]

    return {
        "job": "extension",
        "config": {
            "name": request.output_name,
            "process": [
                {
                    "type": "ui_trainer",
                    "training_folder": request.output_path,
                    "device": f"cuda:{gpu_id}",
                    "network": {
                        "type": hp.get("network_type", "lora"),
                        "linear": hp.get("network_dim", 16),
                        "linear_alpha": hp.get("network_alpha", 16),
                        **(
                            {"dropout": hp.get("network_dropout")}
                            if hp.get("network_dropout", 0) > 0
                            else {}
                        ),
                    },
                    "save": {
                        "dtype": "float16",
                        "save_every": _resolve_save_every_steps(
                            hp,
                            hp.get("epochs", 10),
                            hp.get("steps", defaults.get("steps", 2000)),
                        ),
                        "max_step_saves_to_keep": (
                            hp["max_saves_to_keep"]
                            if hp.get("max_saves_to_keep", 4) > 0
                            else 10_000
                        ),
                        "save_state": hp.get("save_state", False),
                    },
                    "datasets": [
                        {
                            "folder_path": ds.path,
                            "caption_ext": "txt",
                            # Per-folder augmentation, sourced from the UI's
                            # folder-level settings (toolkit/config_modules.py
                            # DatasetConfig). Previously hardcoded here — note
                            # caption_dropout_rate now defaults to 0 (disabled)
                            # rather than the old hardcoded 0.05.
                            "caption_dropout_rate": ds.caption_dropout_rate,
                            "shuffle_tokens": ds.caption_shuffling,
                            "cache_latents_to_disk": True,
                            "resolution": hp.get(
                                "resolution", defaults.get("resolution", [1024])
                            ),
                            "num_repeats": ds.num_repeats,
                            "keep_tokens": ds.keep_tokens,
                            "network_weight": ds.lora_weight,
                            "is_reg": ds.is_regularization,
                            "flip_x": ds.flip_augment,
                            "flip_y": ds.flip_v_augment,
                        }
                        for ds in request.datasets
                    ],
                    "train": {
                        "batch_size": hp.get("batch_size", 1),
                        "steps": hp.get("steps", defaults.get("steps", 2000)),
                        # Force start_step=0 (unless the user explicitly
                        # opted into resume). Without this, ai-toolkit
                        # auto-loads training_info.step from any existing
                        # safetensors in the output dir — so a re-run with
                        # the same output_name silently inherits the prior
                        # run's step counter, often skipping training
                        # entirely (range(prev_step, new_steps) → empty).
                        "start_step": 0
                        if not hp.get("resume_state")
                        else None,
                        "gradient_accumulation_steps": hp.get(
                            "gradient_accumulation_steps", 1
                        ),
                        "train_unet": True,
                        "train_text_encoder": hp.get("train_text_encoder", False),
                        "gradient_checkpointing": True,
                        "noise_scheduler": defaults.get("noise_scheduler", "flowmatch"),
                        "optimizer": hp.get(
                            "optimizer", defaults.get("optimizer", "adamw8bit")
                        ),
                        "lr": hp.get("lr", defaults.get("lr", 1e-4)),
                        **(
                            {"lr_unet": hp["backbone_lr"]}
                            if hp.get("backbone_lr", 0) > 0
                            else {}
                        ),
                        **(
                            {"lr_text_encoder": hp["text_encoder_lr"]}
                            if hp.get("text_encoder_lr", 0) > 0
                            else {}
                        ),
                        "dtype": hp.get(
                            "mixed_precision", defaults.get("dtype", "bf16")
                        ),
                        "max_grad_norm": hp.get("max_grad_norm", 1.0),
                        **(
                            {"ema_config": {"use_ema": True, "ema_decay": 0.99}}
                            if hp.get("ema", False)
                            else {}
                        ),
                        "loss_type": hp.get("loss_type", "mse"),
                        "timestep_type": hp.get("timestep_type", "sigmoid"),
                        "timestep_bias": hp.get("timestep_bias", "balanced"),
                        "cache_text_embeddings": hp.get(
                            "cache_text_embeddings", False
                        ),
                        "unload_text_encoder": hp.get("unload_text_encoder", False),
                        **(
                            {"resume_from_checkpoint": hp.get("resume_state")}
                            if hp.get("resume_state")
                            else {}
                        ),
                    },
                    "model": {
                        "name_or_path": hp.get(
                            "model_path", model_def["model_path"]
                        ),
                        **model_def["config"],
                        "quantize": hp.get(
                            "transformer_quantization", "float8"
                        ) == "float8",
                        "quantize_te": hp.get(
                            "text_encoder_quantization", "float8"
                        ) == "float8",
                    },
                    **(
                        {
                            "sample": {
                                "sampler": defaults.get(
                                    "noise_scheduler", "flowmatch"
                                ),
                                "sample_every": hp.get(
                                    "sample_every_n_steps", 250
                                ),
                                "width": _first_resolution(hp, defaults),
                                "height": _first_resolution(hp, defaults),
                                "prompts": request.sample_prompts,
                                "seed": 42,
                                "walk_seed": True,
                                "guidance_scale": defaults.get("guidance_scale", 4),
                                "sample_steps": defaults.get("sample_steps", 20),
                            },
                        }
                        if request.sample_prompts
                        else {}
                    ),
                }
            ],
            "meta": {"name": request.output_name, "version": "1.0"},
        },
    }


def _parse_speed_string(s: str) -> tuple[Optional[float], Optional[float], Optional[int]]:
    """Pick out loss / lr / eta from ai-toolkit's `speed_string` field
    if present. Format varies — best-effort parse, returns None where
    unrecognised. Don't rely on these being populated."""
    import re

    if not s:
        return None, None, None
    loss_m = re.search(r"loss:\s*([\d.eE+-]+)", s)
    lr_m = re.search(r"lr:\s*([\d.eE+-]+)", s)
    eta_m = re.search(r"(?:eta|ETA)[:\s]+(\d+)", s)
    return (
        float(loss_m.group(1)) if loss_m else None,
        float(lr_m.group(1)) if lr_m else None,
        int(eta_m.group(1)) if eta_m else None,
    )
