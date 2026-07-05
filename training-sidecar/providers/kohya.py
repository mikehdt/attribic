"""Kohya (sd-scripts) training provider.

Currently scoped to Anima (the Cosmos-Predict2-based anime DiT), which is
supported in mainline kohya-ss/sd-scripts via `anima_train_network.py` and the
`networks.lora_anima` module. Anima needs three explicit model paths — the DiT,
the Qwen3-0.6B text encoder, and the Qwen-Image VAE — unlike ai-toolkit which
takes a single checkpoint and resolves the rest.

Training is launched with `accelerate launch <arch>_train_network.py ...` as a
subprocess. Progress is scraped from sd-scripts' tqdm output (which, like
ai-toolkit, goes to stderr), following the same stream-merge pattern as
`providers/ai_toolkit.py`.
"""

import asyncio
import os
import re
import signal
import sys
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Optional

from models import JobProgress, JobStatus, StartJobRequest
from providers.base import TrainingProvider

# sd-scripts' main training bar looks like:
#   steps:   5%|▌         | 150/3000 [00:30<09:30,  2.30it/s, avr_loss=0.0912]
# The step count / elapsed<remaining / postfix are shared with ai-toolkit, but
# the loss key is `avr_loss=` rather than `loss:` and there's no lr in the bar.
TQDM_PATTERN = re.compile(
    r"(\d+)/(\d+)\s+"  # current/total steps
    r"\[([^\]]+)\]\s*"  # elapsed<remaining
    r"(.*)"  # postfix (avr_loss, it/s, etc.)
)
LOSS_PATTERN = re.compile(r"avr_loss[=:]\s*([\d.eE+-]+)")
ETA_PATTERN = re.compile(r"<(\d+):(\d+):?(\d*)")
# tqdm's iteration rate, e.g. "2.30it/s" or "23.01s/it" (slow steps invert it).
RATE_PATTERN = re.compile(r"([\d.]+)\s*(it/s|s/it)")
# sd-scripts prints "epoch 1/10" between epochs.
EPOCH_PATTERN = re.compile(r"epoch\s+(\d+)\s*/\s*(\d+)")


# --- Model definitions ---
#
# Kohya-side catalogue. Scoped to Anima for now; add SDXL/Flux entries here
# (with their own `train_script`) when those backends are lit up.

SUPPORTED_MODELS = [
    {
        "id": "anima",
        "name": "Anima",
        "architecture": "anima",
        # sd-scripts entry script for this architecture.
        "train_script": "anima_train_network.py",
        # LoRA network module implementing the Anima adapter.
        "network_module": "networks.lora_anima",
        "train_defaults": {
            "optimizer": "AdamW8bit",
            "lr": 1e-4,
            "dtype": "bf16",
            "resolution": [768, 1024],
            "steps": 2000,
            # Anima is flow-matching (Cosmos-Predict2 lineage).
            "timestep_sampling": "sigmoid",
            "discrete_flow_shift": 1.0,
        },
    },
]


# sd-scripts optimizer names differ in casing/spelling from the app's values.
_OPTIMIZER_MAP = {
    "adamw8bit": "AdamW8bit",
    "adamw": "AdamW",
    "adafactor": "Adafactor",
    "prodigy": "Prodigy",
    "lion": "Lion",
    "dadaptation": "DAdaptAdam",
}

# App save_format -> sd-scripts --save_precision.
_SAVE_PRECISION_MAP = {"fp16": "fp16", "bf16": "bf16", "fp32": "float"}


def _find_model(model_id: str) -> Optional[dict]:
    for m in SUPPORTED_MODELS:
        if m["id"] == model_id:
            return m
    return None


def _parse_eta_seconds(eta_str: str) -> Optional[int]:
    """Parse a tqdm ETA string like '15:30' or '1:15:30' into seconds."""
    match = ETA_PATTERN.search(eta_str)
    if not match:
        return None
    parts = [int(p) for p in match.groups() if p]
    if len(parts) == 2:
        return parts[0] * 60 + parts[1]
    if len(parts) == 3:
        return parts[0] * 3600 + parts[1] * 60 + parts[2]
    return None


class KohyaProvider(TrainingProvider):
    """Training provider backed by kohya-ss/sd-scripts."""

    def __init__(self, scripts_path: str):
        self._scripts_path = Path(scripts_path)
        self._process: Optional[asyncio.subprocess.Process] = None

    async def validate_environment(self) -> tuple[bool, Optional[str]]:
        if not self._scripts_path.exists():
            return False, f"sd-scripts path does not exist: {self._scripts_path}"

        # Every supported model's train script must be present. Right now that's
        # just Anima's; missing it means this isn't an Anima-capable checkout.
        for model in SUPPORTED_MODELS:
            script = self._scripts_path / model["train_script"]
            if not script.exists():
                return (
                    False,
                    f"sd-scripts checkout at {self._scripts_path} is missing "
                    f"{model['train_script']} — update to a version with Anima "
                    f"support (mainline kohya-ss/sd-scripts).",
                )

        return True, None

    async def generate_config(
        self, request: StartJobRequest, config_dir: str
    ) -> str:
        """Write the sd-scripts dataset config TOML and return its path.

        sd-scripts takes datasets via a TOML file (`--dataset_config`) rather
        than CLI flags. The training-loop flags themselves are assembled in
        `start_training`.
        """
        model_def = _find_model(request.base_model)
        if model_def is None:
            raise ValueError(f"Unknown model: {request.base_model}")

        hp = request.hyperparameters
        defaults = model_def["train_defaults"]

        resolution = hp.get("resolution", defaults.get("resolution", [1024]))
        if not isinstance(resolution, list):
            resolution = [int(resolution)]
        max_res = max(resolution) if resolution else 1024
        min_res = min(resolution) if resolution else max_res
        # Only bucket across resolutions when the user picked more than one;
        # a single resolution trains at that fixed size.
        enable_bucket = len(resolution) > 1

        lines: list[str] = []
        lines.append("[general]")
        lines.append('caption_extension = ".txt"')
        lines.append(
            f"shuffle_caption = {_toml_bool(hp.get('caption_shuffling', False))}"
        )
        lines.append(f"keep_tokens = {int(hp.get('keep_tokens', 0))}")
        lines.append("")
        lines.append("[[datasets]]")
        lines.append(f"resolution = {max_res}")
        lines.append(f"batch_size = {int(hp.get('batch_size', 1))}")
        lines.append(f"enable_bucket = {_toml_bool(enable_bucket)}")
        if enable_bucket:
            lines.append("bucket_no_upscale = false")
            lines.append("bucket_reso_steps = 64")
            lines.append(f"min_bucket_reso = {min_res}")
            lines.append(f"max_bucket_reso = {max_res}")
        caption_dropout = float(hp.get("caption_dropout_rate", 0) or 0)
        if caption_dropout > 0:
            lines.append(f"caption_dropout_rate = {caption_dropout}")
        lines.append("")

        for ds in request.datasets:
            lines.append("[[datasets.subsets]]")
            lines.append(f"image_dir = {_toml_str(ds.path)}")
            lines.append(f"num_repeats = {int(ds.num_repeats)}")
            if ds.is_regularization:
                lines.append("is_reg = true")
            if hp.get("flip_augment", False):
                lines.append("flip_aug = true")
            lines.append("")

        config_path = os.path.join(config_dir, f"{request.output_name}.toml")
        with open(config_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))

        return config_path

    def _build_cli_args(
        self, request: StartJobRequest, dataset_config: str, config_dir: str
    ) -> list[str]:
        """Translate the generic request into sd-scripts CLI flags for Anima."""
        model_def = _find_model(request.base_model)
        assert model_def is not None  # validated in generate_config
        hp = request.hyperparameters
        defaults = model_def["train_defaults"]

        model_paths = hp.get("model_paths") or {}
        dit_path = model_paths.get("checkpoint") or hp.get("model_path")
        qwen_path = model_paths.get("qwen")
        vae_path = model_paths.get("vae")

        missing = [
            name
            for name, val in (
                ("DiT checkpoint", dit_path),
                ("Qwen3 text encoder", qwen_path),
                ("VAE", vae_path),
            )
            if not val
        ]
        if missing:
            raise ValueError(
                "Anima training needs all three model files; missing: "
                + ", ".join(missing)
            )

        train_text_encoder = bool(hp.get("train_text_encoder", False))
        optimizer = _OPTIMIZER_MAP.get(
            str(hp.get("optimizer", "adamw8bit")).lower(), "AdamW8bit"
        )

        args: list[str] = [
            f"--pretrained_model_name_or_path={dit_path}",
            f"--qwen3={qwen_path}",
            f"--vae={vae_path}",
            f"--dataset_config={dataset_config}",
            f"--output_dir={request.output_path}",
            f"--output_name={request.output_name}",
            "--save_model_as=safetensors",
            f"--network_module={model_def['network_module']}",
            f"--network_dim={int(hp.get('network_dim', 16))}",
            f"--network_alpha={_num(hp.get('network_alpha', 16))}",
            f"--learning_rate={_num(hp.get('lr', defaults.get('lr', 1e-4)))}",
            f"--optimizer_type={optimizer}",
            f"--lr_scheduler={hp.get('scheduler', 'constant')}",
            f"--max_train_steps={int(hp.get('steps', defaults.get('steps', 2000)))}",
            f"--train_batch_size={int(hp.get('batch_size', 1))}",
            f"--gradient_accumulation_steps={int(hp.get('gradient_accumulation_steps', 1))}",
            f"--mixed_precision={hp.get('mixed_precision', defaults.get('dtype', 'bf16'))}",
            f"--save_precision={_SAVE_PRECISION_MAP.get(hp.get('save_format', 'fp16'), 'fp16')}",
            f"--max_grad_norm={_num(hp.get('max_grad_norm', 1.0))}",
            # Anima-specific flow-matching controls (documented defaults).
            f"--timestep_sampling={hp.get('timestep_type', defaults.get('timestep_sampling', 'sigmoid'))}",
            f"--discrete_flow_shift={_num(defaults.get('discrete_flow_shift', 1.0))}",
            # Qwen-Image VAE is memory-hungry at full frame; chunking keeps it
            # within budget (matches the sd-scripts Anima doc example).
            "--vae_chunk_size=64",
        ]

        # Optimizer-specific extras.
        if float(hp.get("weight_decay", 0) or 0) > 0 and optimizer in (
            "AdamW",
            "AdamW8bit",
        ):
            args.append(
                f'--optimizer_args=weight_decay={_num(hp["weight_decay"])}'
            )

        # Seed — only pin it when the user chose a fixed value; -1 means
        # "random", which sd-scripts gets by us omitting the flag entirely.
        seed = int(hp.get("seed", -1))
        if seed >= 0:
            args.append(f"--seed={seed}")

        # Warmup — only meaningful for schedulers that ramp.
        warmup = int(hp.get("warmup_steps", 0) or 0)
        if warmup > 0:
            args.append(f"--lr_warmup_steps={warmup}")

        # Cosine-with-restarts needs a cycle count.
        if hp.get("scheduler") == "cosine_with_restarts":
            args.append(
                f"--lr_scheduler_num_cycles={int(hp.get('num_restarts', 1))}"
            )

        # LoRA dropout.
        if float(hp.get("network_dropout", 0) or 0) > 0:
            args.append(f"--network_dropout={_num(hp['network_dropout'])}")

        # Boolean training flags.
        if hp.get("gradient_checkpointing", True):
            args.append("--gradient_checkpointing")
        if hp.get("cache_latents", True):
            args.append("--cache_latents")
            args.append("--cache_latents_to_disk")
        # Keep the DataLoader workers alive between epochs. Without this,
        # sd-scripts tears them down and respawns them at every epoch boundary
        # — a visible stall, and the source of the repeated "epoch is
        # incremented" log spam (one line per freshly-respawned worker).
        args.append("--persistent_data_loader_workers")

        # Text encoder: Anima keeps the Qwen3 "LLM adapter" frozen by default.
        # When not training it, we can precompute and cache its outputs (big
        # VRAM/time win). When the user opts to train it, wire an LR through.
        if train_text_encoder:
            te_lr = hp.get("text_encoder_lr", 0) or 0
            if float(te_lr) > 0:
                args.append(f"--text_encoder_lr={_num(te_lr)}")
            # sd-scripts trains the Anima LLM adapter via a network arg.
            args.append("--network_args")
            args.append("train_llm_adapter=True")
        else:
            # Frozen TE: precompute its outputs. sd-scripts requires the
            # network to be UNet/DiT-only when caching TE outputs, otherwise it
            # asserts (a cached TE can't also have trainable LoRA weights).
            args.append("--network_train_unet_only")
            args.append("--cache_text_encoder_outputs")

        # NOTE: --fp8_base is deliberately NOT emitted — sd-scripts does not
        # support fp8 for Anima. The UI hides the quantization fields for this
        # model accordingly.

        # Checkpoint saving.
        save_every_epochs = int(hp.get("save_every_n_epochs", 0) or 0)
        if save_every_epochs > 0:
            args.append(f"--save_every_n_epochs={save_every_epochs}")
        max_keep = int(hp.get("max_saves_to_keep", 0) or 0)
        if max_keep > 0:
            args.append(f"--save_last_n_epochs={max_keep}")

        # Sample generation during training.
        if request.sample_prompts:
            prompt_file = os.path.join(
                config_dir, f"{request.output_name}.sample-prompts.txt"
            )
            with open(prompt_file, "w", encoding="utf-8") as f:
                f.write("\n".join(request.sample_prompts))
            args.append(f"--sample_prompts={prompt_file}")
            args.append(
                f"--sample_every_n_steps={int(hp.get('sample_every_n_steps', 250))}"
            )
            args.append("--sample_sampler=euler_a")

        # Resume from a saved training state directory.
        if hp.get("resume_state"):
            args.append(f"--resume={hp['resume_state']}")
        if hp.get("save_state", False):
            args.append("--save_state")

        return args

    async def start_training(
        self, request: StartJobRequest, config_path: str, gpu_id: int = 0
    ) -> AsyncGenerator[JobProgress, None]:
        job_id = request.output_name  # Overridden by caller with the real job ID

        model_def = _find_model(request.base_model)
        if model_def is None:
            raise ValueError(f"Unknown model: {request.base_model}")

        python_exe = _find_python(self._scripts_path)
        script = str(self._scripts_path / model_def["train_script"])
        config_dir = os.path.dirname(config_path)
        cli_args = self._build_cli_args(request, config_path, config_dir)
        mixed_precision = request.hyperparameters.get("mixed_precision", "bf16")

        # Launch via accelerate. We pass explicit launch flags rather than rely
        # on a machine-level `accelerate config`, so a single-GPU run is
        # deterministic regardless of the user's global accelerate defaults.
        self._process = await asyncio.create_subprocess_exec(
            python_exe,
            "-u",
            "-m",
            "accelerate.commands.launch",
            "--num_processes=1",
            "--num_machines=1",
            f"--mixed_precision={mixed_precision}",
            "--dynamo_backend=no",
            "--num_cpu_threads_per_process=1",
            script,
            *cli_args,
            cwd=str(self._scripts_path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={
                **os.environ,
                "PYTHONUNBUFFERED": "1",
                # sd-scripts prints Japanese log strings. When stdout/stderr are
                # pipes (as here), Windows Python defaults to cp1252 and crashes
                # with UnicodeEncodeError before training starts. Force UTF-8 so
                # the child can emit those characters.
                "PYTHONUTF8": "1",
                "PYTHONIOENCODING": "utf-8",
                "CUDA_VISIBLE_DEVICES": str(gpu_id),
            },
        )

        yield JobProgress(job_id=job_id, status=JobStatus.PREPARING)

        log_lines: list[str] = []
        stderr_lines: list[str] = []
        sample_paths: list[str] = []
        current_epoch = 0
        total_epochs = 0

        async def read_stream(stream: asyncio.StreamReader):
            """Read lines, splitting on tqdm's \\r as well as \\n."""
            buffer = ""
            while True:
                chunk = await stream.read(256)
                if not chunk:
                    break
                buffer += chunk.decode("utf-8", errors="replace")
                while "\r" in buffer or "\n" in buffer:
                    for sep in ["\n", "\r"]:
                        if sep in buffer:
                            line, buffer = buffer.split(sep, 1)
                            line = line.strip()
                            if line:
                                yield line
                            break

        # sd-scripts (via accelerate/tqdm) writes progress to stderr, so we
        # merge both streams — see the equivalent note in ai_toolkit.py.
        line_queue: asyncio.Queue = asyncio.Queue()
        EOF = object()

        async def drain(stream, is_stderr: bool):
            async for line in read_stream(stream):
                await line_queue.put((line, is_stderr))
            await line_queue.put((EOF, is_stderr))

        stdout_task = asyncio.create_task(drain(self._process.stdout, False))
        stderr_task = asyncio.create_task(drain(self._process.stderr, True))

        training_started = False
        # Last training step counts seen, so the terminal COMPLETED event can
        # report the bar as full (N/N) rather than dropping back to 0/0.
        current_step = 0
        total_steps = 0
        # Last loss seen, so activity events between steps (saving/sampling)
        # keep showing it rather than blanking the value mid-save.
        last_loss: Optional[float] = None
        # Human-readable label for the current setup phase. Latched from the
        # INFO/loader lines sd-scripts prints just before each tqdm bar, so it
        # survives the rapid bar redraws that would otherwise scroll the header
        # out of any fixed-size log window.
        preparing_phase: Optional[str] = None
        eofs_seen = 0
        while eofs_seen < 2:
            item, is_stderr = await line_queue.get()
            if item is EOF:
                eofs_seen += 1
                continue
            line = item

            if is_stderr:
                stderr_lines.append(line)

            # Track which setup phase we're in so the caching/loading tqdm bars
            # can be labelled and shown with a determinate progress bar.
            lower_line = line.lower()
            if "caching latents" in lower_line:
                preparing_phase = "Caching latents"
            elif "caching text encoder" in lower_line:
                preparing_phase = "Caching text-encoder outputs"
            elif "loading" in lower_line and "safetensors" in lower_line:
                preparing_phase = "Loading model"

            epoch_match = EPOCH_PATTERN.search(line)
            if epoch_match:
                current_epoch = int(epoch_match.group(1))
                total_epochs = int(epoch_match.group(2))

            match = TQDM_PATTERN.search(line)
            # avr_loss and the it/s rate both sit *inside* the tqdm bracket, so
            # search the whole line rather than the post-bracket remainder.
            loss_match = LOSS_PATTERN.search(line) if match else None
            rate_match = RATE_PATTERN.search(line) if match else None

            # sd-scripts shows several tqdm bars (caching latents, caching TE
            # outputs, then the training loop). Only the training bar is
            # prefixed with "steps" and/or carries avr_loss — latch on that so
            # setup bars stay under the Preparing label.
            is_training_bar = bool(
                match
                and (
                    loss_match
                    or line.lower().startswith("steps")
                    or training_started
                )
            )

            if match and is_training_bar:
                training_started = True
                current_step = int(match.group(1))
                total_steps = int(match.group(2))
                eta = _parse_eta_seconds(match.group(3))

                speed = (
                    f"{rate_match.group(1)} {rate_match.group(2)}"
                    if rate_match
                    else None
                )
                if loss_match:
                    last_loss = float(loss_match.group(1))

                yield JobProgress(
                    job_id=job_id,
                    status=JobStatus.TRAINING,
                    current_step=current_step,
                    total_steps=total_steps,
                    current_epoch=current_epoch,
                    total_epochs=total_epochs,
                    loss=last_loss,
                    eta_seconds=eta,
                    speed=speed,
                    sample_image_paths=sample_paths,
                    log_lines=log_lines[-50:],
                    # An advancing step means we're actively training — clear
                    # any transient activity label (e.g. a prior "Saving").
                    phase=None,
                )
            else:
                # Collapse consecutive identical lines — sd-scripts repeats
                # some (e.g. "epoch is incremented", one per DataLoader worker)
                # which would otherwise flood the log panel.
                if not log_lines or log_lines[-1] != line:
                    log_lines.append(line)

                lower = line.lower()
                if "saved sample" in lower or (
                    "sample" in lower
                    and (line.endswith(".png") or line.endswith(".jpg"))
                ):
                    sample_paths.append(line.rsplit(" ", 1)[-1].strip())

                if training_started:
                    # Between steps sd-scripts pauses to save checkpoints or
                    # generate samples — the step bar freezes during that, so
                    # surface what it's doing as a one-line activity label.
                    activity = None
                    if "saving checkpoint" in lower or "saving model" in lower:
                        activity = "Saving checkpoint"
                    elif "generating sample" in lower or (
                        "sample" in lower and "generat" in lower
                    ):
                        activity = "Generating samples"
                    elif "model saved" in lower:
                        activity = "Checkpoint saved"
                    if activity is not None:
                        yield JobProgress(
                            job_id=job_id,
                            status=JobStatus.TRAINING,
                            current_step=current_step,
                            total_steps=total_steps,
                            current_epoch=current_epoch,
                            total_epochs=total_epochs,
                            loss=last_loss,
                            phase=activity,
                            sample_image_paths=sample_paths,
                            log_lines=log_lines[-50:],
                        )
                else:
                    # A tqdm bar here is a setup phase (caching latents / TE
                    # outputs / loading the DiT) — surface its count so the UI
                    # can show a determinate bar under the phase label.
                    prep_current = 0
                    prep_total = 0
                    if match:
                        prep_current = int(match.group(1))
                        prep_total = int(match.group(2))
                    yield JobProgress(
                        job_id=job_id,
                        status=JobStatus.PREPARING,
                        current_step=prep_current,
                        total_steps=prep_total,
                        phase=preparing_phase,
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
                # Report the bar as full so the UI settles at 100% instead of
                # snapping the completed bar back to empty.
                current_step=total_steps,
                total_steps=total_steps,
                current_epoch=current_epoch,
                total_epochs=total_epochs,
                log_lines=log_lines[-50:],
                sample_image_paths=sample_paths,
            )
        else:
            tail = stderr_lines[-10:] if stderr_lines else log_lines[-10:]
            detail = "\n".join(tail).strip()
            error_msg = f"Training process exited with code {return_code}"
            if detail:
                error_msg = f"{error_msg}\n{detail}"
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
            # accelerate spawns child worker processes; kill the whole tree.
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


def _toml_bool(value: bool) -> str:
    return "true" if value else "false"


def _toml_str(value: str) -> str:
    """Emit a TOML basic string with backslashes/quotes escaped.

    Windows dataset paths are full of backslashes, which TOML treats as escape
    sequences — escaping them keeps the generated config valid.
    """
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def _num(value) -> str:
    """Format a number for a CLI flag without trailing float noise.

    Integers stay integers; floats keep their repr (e.g. 1e-4 -> '0.0001').
    """
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    f = float(value)
    if f.is_integer():
        return str(int(f))
    return repr(f)


def _find_python(scripts_path: Path) -> str:
    """Find the Python executable for the sd-scripts environment.

    Mirrors ai_toolkit._find_python: prefer a `venv`/`.venv` inside the
    checkout, then a sibling `python_embeded`, then fall back to the sidecar's
    own interpreter (which will fail loudly rather than hang).
    """
    if sys.platform == "win32":
        candidates = [
            scripts_path / "venv" / "Scripts" / "python.exe",
            scripts_path / ".venv" / "Scripts" / "python.exe",
            scripts_path.parent / "python_embeded" / "python.exe",
        ]
    else:
        candidates = [
            scripts_path / "venv" / "bin" / "python",
            scripts_path / ".venv" / "bin" / "python",
            scripts_path.parent / "python_embeded" / "bin" / "python",
        ]

    for candidate in candidates:
        if candidate.exists():
            return str(candidate)

    return sys.executable
