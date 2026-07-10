"""ai-toolkit (Ostris) training provider.

Spawns training as a subprocess via ai-toolkit's run.py, generates YAML configs,
and parses tqdm stdout for progress updates.
"""

import asyncio
import os
import re
import signal
import sys
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Optional

import yaml

from models import JobProgress, JobStatus, StartJobRequest
from providers.base import TrainingProvider

# Regex to parse tqdm progress output:
# my_lora:  25%|███| 500/2000 [05:30<15:30, 1.50it/s] lr: 1.0e-04 loss: 8.532e-02
TQDM_PATTERN = re.compile(
    r"(\d+)/(\d+)\s+"  # current/total steps
    r"\[([^\]]+)\]\s*"  # elapsed<remaining
    r"(.*)"  # postfix (lr, loss, etc.)
)

LOSS_PATTERN = re.compile(r"loss:\s*([\d.eE+-]+)")
LR_PATTERN = re.compile(r"lr:\s*([\d.eE+-]+)")
ETA_PATTERN = re.compile(r"<(\d+):(\d+):?(\d*)")


# --- Model definitions ---

SUPPORTED_MODELS = [
    {
        "id": "flux-dev",
        "name": "Flux.1 Dev",
        "architecture": "flux",
        "model_path": "black-forest-labs/FLUX.1-dev",
        "config": {"arch": "flux", "quantize": True},
        "train_defaults": {
            "noise_scheduler": "flowmatch",
            "optimizer": "adamw8bit",
            "lr": 1e-4,
            "dtype": "bf16",
            "resolution": [512, 768, 1024],
            "steps": 2000,
            "guidance_scale": 4,
            "sample_steps": 20,
        },
    },
    {
        "id": "flux-schnell",
        "name": "Flux.1 Schnell",
        "architecture": "flux",
        "model_path": "black-forest-labs/FLUX.1-schnell",
        "config": {"arch": "flux", "quantize": True},
        "train_defaults": {
            "noise_scheduler": "flowmatch",
            "optimizer": "adamw8bit",
            "lr": 1e-4,
            "dtype": "bf16",
            "resolution": [512, 768, 1024],
            "steps": 1500,
            "guidance_scale": 1,
            "sample_steps": 4,
        },
    },
    {
        # Node catalogue id is "flux2"; ai-toolkit arch is the 9B Klein variant
        # (extensions_built_in/diffusion_models/flux2/flux2_klein_model.py).
        # Klein-base is NOT guidance-distilled, so CFG is on for samples
        # (guidance_scale > 1), unlike flux-dev.
        "id": "flux2",
        "name": "Flux.2 Klein 9B",
        "architecture": "flux2_klein_9b",
        "model_path": "black-forest-labs/FLUX.2-klein-base-9B",
        "config": {"arch": "flux2_klein_9b", "quantize": True},
        "train_defaults": {
            "noise_scheduler": "flowmatch",
            "optimizer": "adamw8bit",
            "lr": 1e-4,
            "dtype": "bf16",
            "resolution": [1024],
            "steps": 2000,
            "guidance_scale": 4,
            "sample_steps": 30,
        },
    },
    {
        "id": "sdxl",
        "name": "Stable Diffusion XL",
        "architecture": "sdxl",
        "model_path": "stabilityai/stable-diffusion-xl-base-1.0",
        "config": {"arch": "sdxl"},
        "train_defaults": {
            "noise_scheduler": "ddpm",
            "optimizer": "adamw8bit",
            "lr": 1e-4,
            "dtype": "bf16",
            "resolution": [1024],
            "steps": 3000,
            "guidance_scale": 7,
            "sample_steps": 25,
        },
    },
    # Illustrious XL / NoobAI XL are SDXL-architecture finetunes — same arch and
    # training config as sdxl above. The client always sends the local
    # checkpoint as `model_path`, so the HF fallback just mirrors sdxl's.
    {
        "id": "illustrious-xl",
        "name": "Illustrious XL",
        "architecture": "sdxl",
        "model_path": "stabilityai/stable-diffusion-xl-base-1.0",
        "config": {"arch": "sdxl"},
        "train_defaults": {
            "noise_scheduler": "ddpm",
            "optimizer": "adamw8bit",
            "lr": 1e-4,
            "dtype": "bf16",
            "resolution": [1024],
            "steps": 3000,
            "guidance_scale": 7,
            "sample_steps": 25,
        },
    },
    {
        "id": "noob-ai-xl",
        "name": "NoobAI XL",
        "architecture": "sdxl",
        "model_path": "stabilityai/stable-diffusion-xl-base-1.0",
        "config": {"arch": "sdxl"},
        "train_defaults": {
            "noise_scheduler": "ddpm",
            "optimizer": "adamw8bit",
            "lr": 1e-4,
            "dtype": "bf16",
            "resolution": [1024],
            "steps": 3000,
            "guidance_scale": 7,
            "sample_steps": 25,
        },
    },
    {
        "id": "zimage-turbo",
        "name": "Z-Image Turbo",
        "architecture": "zimage",
        "model_path": "Tongyi-MAI/Z-Image-Turbo",
        "config": {"arch": "zimage"},
        "train_defaults": {
            "noise_scheduler": "flowmatch",
            "optimizer": "adamw8bit",
            "lr": 1e-4,
            "dtype": "bf16",
            "resolution": [512, 768, 1024],
            "steps": 2000,
            "guidance_scale": 4,
            "sample_steps": 8,
        },
    },
    {
        "id": "wan22-14b",
        "name": "Wan 2.2 14B",
        "architecture": "wan22_14b",
        "model_path": "ai-toolkit/Wan2.2-T2V-A14B-Diffusers-bf16",
        "config": {"arch": "wan22_14b"},
        "train_defaults": {
            "noise_scheduler": "flowmatch",
            "optimizer": "adamw8bit",
            "lr": 2e-4,
            "dtype": "bf16",
            "resolution": [512, 768],
            "steps": 2000,
            "guidance_scale": 4,
            "sample_steps": 20,
        },
    },
    {
        "id": "ltx2",
        "name": "LTX-Video 2",
        "architecture": "ltx2",
        "model_path": "Lightricks/LTX-Video-0.9.7-dev",
        "config": {"arch": "ltx2"},
        "train_defaults": {
            "noise_scheduler": "flowmatch",
            "optimizer": "adamw8bit",
            "lr": 1e-4,
            "dtype": "bf16",
            "resolution": [512, 768],
            "steps": 2000,
            "guidance_scale": 4,
            "sample_steps": 20,
        },
    },
    {
        # Node catalogue id is "ltx23"; ai-toolkit arch is "ltx2.3"
        # (LTX23Model in extensions_built_in/diffusion_models/ltx2/ltx2.py).
        "id": "ltx23",
        "name": "LTX-Video 2.3",
        "architecture": "ltx2.3",
        "model_path": "Lightricks/LTX-2",
        "config": {"arch": "ltx2.3"},
        "train_defaults": {
            "noise_scheduler": "flowmatch",
            "optimizer": "adamw8bit",
            "lr": 1e-4,
            "dtype": "bf16",
            "resolution": [512, 768],
            "steps": 2000,
            "guidance_scale": 4,
            "sample_steps": 30,
        },
    },
]


def _find_model(model_id: str) -> Optional[dict]:
    for m in SUPPORTED_MODELS:
        if m["id"] == model_id:
            return m
    return None


def _parse_eta_seconds(eta_str: str) -> Optional[int]:
    """Parse tqdm ETA string like '15:30' or '1:15:30' into seconds."""
    match = ETA_PATTERN.search(eta_str)
    if not match:
        return None
    parts = [int(p) for p in match.groups() if p]
    if len(parts) == 2:
        return parts[0] * 60 + parts[1]
    if len(parts) == 3:
        return parts[0] * 3600 + parts[1] * 60 + parts[2]
    return None


class AiToolkitProvider(TrainingProvider):
    """Training provider backed by ostris/ai-toolkit."""

    def __init__(self, toolkit_path: str):
        self._toolkit_path = Path(toolkit_path)
        self._process: Optional[asyncio.subprocess.Process] = None

    async def validate_environment(self) -> tuple[bool, Optional[str]]:
        run_py = self._toolkit_path / "run.py"
        if not run_py.exists():
            return False, f"ai-toolkit not found at {self._toolkit_path} (missing run.py)"

        toolkit_init = self._toolkit_path / "toolkit" / "job.py"
        if not toolkit_init.exists():
            return False, f"ai-toolkit installation appears incomplete (missing toolkit/job.py)"

        return True, None

    async def generate_config(
        self, request: StartJobRequest, config_dir: str
    ) -> str:
        model_def = _find_model(request.base_model)
        if model_def is None:
            raise ValueError(f"Unknown model: {request.base_model}")

        hp = request.hyperparameters
        defaults = model_def["train_defaults"]

        # Build the ai-toolkit YAML config
        config = {
            "job": "extension",
            "config": {
                "name": request.output_name,
                "process": [
                    {
                        "type": "sd_trainer",
                        "training_folder": request.output_path,
                        "device": "cuda:0",
                        # Training-time RNG seed (torch/cuda/random), read by
                        # BaseTrainProcess.__init__ via
                        # get_conf('training_seed', ...) — a process-level key,
                        # sibling to network/save/datasets/train/model/sample
                        # below. Distinct from the sample block's own
                        # hardcoded seed=42 (that reproducibly walks sample
                        # images across saves; this is the actual
                        # training-loop seed). -1 means "random" client-side,
                        # so only emit when the user picked a fixed value.
                        **(
                            {"training_seed": int(hp["seed"])}
                            if int(hp.get("seed", -1)) >= 0
                            else {}
                        ),
                        "network": {
                            "type": hp.get("network_type", "lora"),
                            "linear": hp.get("network_dim", 16),
                            "linear_alpha": hp.get("network_alpha", 16),
                            # network_dropout defaults to 0 (disabled); only
                            # emit when the user explicitly set it
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
                            # Rolling checkpoint window. 0 means "keep all" —
                            # ai-toolkit uses a large sentinel for that.
                            "max_step_saves_to_keep": (
                                hp["max_saves_to_keep"]
                                if hp.get("max_saves_to_keep", 4) > 0
                                else 10_000
                            ),
                            # Full training state snapshot so runs can resume.
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
                            "gradient_accumulation_steps": hp.get(
                                "gradient_accumulation_steps", 1
                            ),
                            "train_unet": True,
                            "train_text_encoder": hp.get(
                                "train_text_encoder", False
                            ),
                            "gradient_checkpointing": True,
                            "noise_scheduler": defaults.get(
                                "noise_scheduler", "flowmatch"
                            ),
                            "optimizer": hp.get(
                                "optimizer", defaults.get("optimizer", "adamw8bit")
                            ),
                            "lr": hp.get("lr", defaults.get("lr", 1e-4)),
                            # Per-component LR overrides — 0 means "use main LR"
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
                            # EMA — ai-toolkit expects an ema_config block
                            **(
                                {"ema_config": {"use_ema": True, "ema_decay": 0.99}}
                                if hp.get("ema", False)
                                else {}
                            ),
                            "loss_type": hp.get("loss_type", "mse"),
                            "timestep_type": hp.get("timestep_type", "sigmoid"),
                            "timestep_bias": hp.get("timestep_bias", "balanced"),
                            # Text-encoder VRAM optimisations
                            "cache_text_embeddings": hp.get(
                                "cache_text_embeddings", False
                            ),
                            "unload_text_encoder": hp.get(
                                "unload_text_encoder", False
                            ),
                            # Point at a previously saved training-state dir
                            # to continue from where a prior run left off.
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
                            # Separate transformer vs text-encoder quantization
                            # overrides the model-level `quantize` default.
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
                                    "sampler": _resolve_sample_sampler(hp, defaults),
                                    "sample_every": hp.get(
                                        "sample_every_n_steps", 250
                                    ),
                                    "width": _first_resolution(hp, defaults),
                                    "height": _first_resolution(hp, defaults),
                                    "prompts": request.sample_prompts,
                                    "seed": 42,
                                    "walk_seed": True,
                                    "guidance_scale": hp.get(
                                        "guidance_scale",
                                        defaults.get("guidance_scale", 4),
                                    ),
                                    "sample_steps": hp.get(
                                        "sample_steps",
                                        defaults.get("sample_steps", 20),
                                    ),
                                },
                            }
                            if request.sample_prompts
                            else {}
                        ),
                    }
                ],
            },
            "meta": {"name": request.output_name, "version": "1.0"},
        }

        config_path = os.path.join(config_dir, f"{request.output_name}.yaml")
        with open(config_path, "w", encoding="utf-8") as f:
            yaml.dump(config, f, default_flow_style=False, sort_keys=False)

        return config_path

    async def start_training(
        self, request: StartJobRequest, config_path: str, gpu_id: int = 0
    ) -> AsyncGenerator[JobProgress, None]:
        job_id = request.output_name  # Will be overridden by caller with real job ID

        # Find the Python executable — prefer the ai-toolkit venv
        python_exe = _find_python(self._toolkit_path)
        run_py = str(self._toolkit_path / "run.py")

        self._process = await asyncio.create_subprocess_exec(
            python_exe,
            "-u",
            run_py,
            config_path,
            cwd=str(self._toolkit_path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={
                **os.environ,
                "PYTHONUNBUFFERED": "1",
                "CUDA_VISIBLE_DEVICES": str(gpu_id),
            },
        )

        # Yield preparing status
        yield JobProgress(job_id=job_id, status=JobStatus.PREPARING)

        log_lines: list[str] = []
        stderr_lines: list[str] = []
        sample_paths: list[str] = []

        async def read_stream(
            stream: asyncio.StreamReader, is_stderr: bool = False
        ):
            """Read lines from a stream, handling tqdm's CR-based updates."""
            buffer = ""
            while True:
                chunk = await stream.read(256)
                if not chunk:
                    break
                text = chunk.decode("utf-8", errors="replace")
                buffer += text
                # tqdm uses \r for progress updates, \n for log lines
                while "\r" in buffer or "\n" in buffer:
                    # Split on either \r or \n
                    for sep in ["\n", "\r"]:
                        if sep in buffer:
                            line, buffer = buffer.split(sep, 1)
                            line = line.strip()
                            if line:
                                yield line
                            break

        # Merge stdout and stderr into one queue. tqdm writes progress to
        # stderr by default (ai-toolkit does this), so if we only parsed
        # stdout we'd miss every step and the UI would stay on "Preparing…"
        # for the whole run. Draining both also prevents the child process
        # from blocking on a full stderr pipe buffer (~4-8KB on Windows),
        # which would otherwise hide Python tracebacks entirely.
        line_queue: asyncio.Queue = asyncio.Queue()
        EOF = object()

        async def drain(stream, is_stderr: bool):
            async for line in read_stream(stream, is_stderr=is_stderr):
                await line_queue.put((line, is_stderr))
            await line_queue.put((EOF, is_stderr))

        stdout_task = asyncio.create_task(drain(self._process.stdout, False))
        stderr_task = asyncio.create_task(drain(self._process.stderr, True))

        # Until the first tqdm line arrives we're still in the "preparing"
        # phase — ai-toolkit can spend several minutes loading the base
        # model, quantizing, caching latents, etc. Yield a PREPARING
        # progress on each log line so the UI shows what's happening.
        training_started = False
        eofs_seen = 0
        while eofs_seen < 2:
            item, is_stderr = await line_queue.get()
            if item is EOF:
                eofs_seen += 1
                continue
            line = item

            if is_stderr:
                stderr_lines.append(line)

            match = TQDM_PATTERN.search(line)
            postfix = match.group(4) if match else ""
            loss_match = LOSS_PATTERN.search(postfix) if match else None
            lr_match = LR_PATTERN.search(postfix) if match else None

            # ai-toolkit emits several tqdm bars during a run: caching
            # latents, text-encoder passes, epoch counters, and the actual
            # training loop. Only the training loop carries lr:/loss: in
            # its postfix, so we use that as the discriminator — once we
            # see one, latch training_started and treat all subsequent
            # tqdm matches as training steps (the first few ticks may not
            # have loss yet).
            is_training_bar = bool(
                match and (loss_match or lr_match or training_started)
            )

            if match and is_training_bar:
                training_started = True
                current_step = int(match.group(1))
                total_steps = int(match.group(2))
                time_info = match.group(3)
                eta = _parse_eta_seconds(time_info)

                yield JobProgress(
                    job_id=job_id,
                    status=JobStatus.TRAINING,
                    current_step=current_step,
                    total_steps=total_steps,
                    loss=float(loss_match.group(1)) if loss_match else None,
                    learning_rate=float(lr_match.group(1)) if lr_match else None,
                    eta_seconds=eta,
                    sample_image_paths=sample_paths,
                    log_lines=log_lines[-50:],
                )
            else:
                # Setup bar or regular log line. Keep it in the log so
                # the UI can surface "Caching latents 3/4", "Encoding
                # text 30/30" etc. under the Preparing label.
                log_lines.append(line)

                if "sample" in line.lower() and (
                    line.endswith(".png") or line.endswith(".jpg")
                ):
                    sample_paths.append(line.strip())

                if not training_started:
                    yield JobProgress(
                        job_id=job_id,
                        status=JobStatus.PREPARING,
                        log_lines=log_lines[-50:],
                        sample_image_paths=sample_paths,
                    )

        await stdout_task
        await stderr_task
        return_code = await self._process.wait()
        self._process = None

        if return_code == 0:
            yield JobProgress(
                job_id=job_id,
                status=JobStatus.COMPLETED,
                log_lines=log_lines[-50:],
                sample_image_paths=sample_paths,
            )
        else:
            # Surface stderr — ai-toolkit often only logs useful errors there
            # (Python tracebacks, argparse failures, missing deps). Fall back
            # to stdout if stderr is empty.
            tail = stderr_lines[-10:] if stderr_lines else log_lines[-10:]
            detail = "\n".join(tail).strip()
            error_msg = f"Training process exited with code {return_code}"
            if detail:
                error_msg = f"{error_msg}\n{detail}"

            # Merge stderr into logs so the UI log view sees them too.
            merged_logs = (log_lines + stderr_lines)[-50:]

            yield JobProgress(
                job_id=job_id,
                status=JobStatus.FAILED,
                error=error_msg,
                log_lines=merged_logs,
            )

    async def cancel_training(self) -> None:
        if self._process is None:
            return

        if sys.platform == "win32":
            # On Windows, kill the process tree
            os.system(f"taskkill /F /T /PID {self._process.pid}")
        else:
            self._process.send_signal(signal.SIGTERM)

        try:
            await asyncio.wait_for(self._process.wait(), timeout=10)
        except asyncio.TimeoutError:
            self._process.kill()

        self._process = None

    def get_supported_models(self) -> list[dict]:
        return [
            {"id": m["id"], "name": m["name"], "architecture": m["architecture"]}
            for m in SUPPORTED_MODELS
        ]


# --- Helpers ---


def _steps_per_epoch(save_every_n_epochs: int, epochs: int, total_steps: int) -> int:
    """Convert save-every-N-epochs to save-every-N-steps."""
    if epochs <= 0:
        return total_steps
    steps_per_epoch = total_steps // epochs
    return max(1, steps_per_epoch * save_every_n_epochs)


def _resolve_save_every_steps(hp: dict, epochs: int, total_steps: int) -> int:
    """Resolve the checkpoint cadence in *steps* — ai-toolkit's native unit.

    The Node side sends `save_every_n_steps` when the user picked step-based
    saving, or `save_every_n_epochs` for epoch-based; whichever is non-zero
    wins (steps take precedence). When both are 0 (saving disabled) the cadence
    is pushed past the end of training so no intermediate checkpoints are
    written.
    """
    save_every_steps = int(hp.get("save_every_n_steps", 0) or 0)
    if save_every_steps > 0:
        return save_every_steps
    save_every_epochs = int(hp.get("save_every_n_epochs", 0) or 0)
    if save_every_epochs > 0:
        return _steps_per_epoch(save_every_epochs, epochs, total_steps)
    return max(1, total_steps) + 1


def _resolve_sample_sampler(hp: dict, defaults: dict) -> str:
    """Resolve the sampler used for training-time sample images.

    ai-toolkit's `sample.sampler` is fed straight into `toolkit.sampler.get_sampler`
    (see toolkit/stable_diffusion_model.py), which instantiates a diffusers
    scheduler class by name. For flow-matching architectures (Flux, Z-Image,
    Wan, LTX — anything with a "flowmatch" `noise_scheduler` model default)
    that *must* stay "flowmatch" (CustomFlowMatchEulerDiscreteScheduler) —
    picking a classic diffusion sampler like "euler_a" would build a
    non-flow-matching scheduler for a flow-matching transformer and produce
    garbage samples. Only non-flow-matching archs (SDXL family, "ddpm") honor
    the user's `sample_sampler` choice.
    """
    model_scheduler = defaults.get("noise_scheduler", "flowmatch")
    if model_scheduler == "flowmatch":
        return "flowmatch"
    return hp.get("sample_sampler", model_scheduler)


def _first_resolution(hp: dict, defaults: dict) -> int:
    """Get the first (largest) resolution value for sample generation."""
    res = hp.get("resolution", defaults.get("resolution", [1024]))
    if isinstance(res, list):
        return max(res) if res else 1024
    return int(res)


def _find_python(toolkit_path: Path) -> str:
    """Find the Python executable for ai-toolkit's environment.

    Checks, in order:
      1. `venv/` or `.venv/` inside the toolkit path (git-clone + uv/pip setup)
      2. `python_embeded/python.exe` in the toolkit's parent dir
         (Windows "Start-AI-Toolkit.bat" / portable-installer convention,
         same as ComfyUI portable — ships with the installer launcher at
         the parent directory level)
      3. the sidecar's own Python (won't work without ai-toolkit's deps,
         but gives a clearer error than a silent hang)
    """
    if sys.platform == "win32":
        candidates = [
            toolkit_path / "venv" / "Scripts" / "python.exe",
            toolkit_path / ".venv" / "Scripts" / "python.exe",
            toolkit_path.parent / "python_embeded" / "python.exe",
        ]
    else:
        candidates = [
            toolkit_path / "venv" / "bin" / "python",
            toolkit_path / ".venv" / "bin" / "python",
            toolkit_path.parent / "python_embeded" / "bin" / "python",
        ]

    for candidate in candidates:
        if candidate.exists():
            return str(candidate)

    return sys.executable
