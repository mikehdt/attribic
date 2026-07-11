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
# Kohya-side catalogue. Each entry carries the per-architecture differences —
# entry script, LoRA network module, which model-file components it needs, and
# a handful of arch-specific flags — so `_build_cli_args` stays generic and the
# common training args flow identically for every model. Add new architectures
# here (with their own `train_script`) rather than branching in the builder.
#
# Component spec: `components` lists the model files an arch needs, each mapped
# to the sd-scripts CLI flag that carries its path. `required` entries raise if
# the client didn't send a path; the "checkpoint" key additionally falls back
# to the flat `model_path` hyperparameter. SDXL resolves the VAE/TEs from the
# single checkpoint, so it only requires the checkpoint (VAE optional); Anima
# needs the DiT, Qwen3 TE and Qwen-Image VAE as three explicit files.

SUPPORTED_MODELS = [
    {
        "id": "sdxl",
        "name": "Stable Diffusion XL",
        "architecture": "sdxl",
        "train_script": "sdxl_train_network.py",
        # Standard SDXL LoRA module (networks/lora.py).
        "network_module": "networks.lora",
        "components": [
            {
                "key": "checkpoint",
                "flag": "pretrained_model_name_or_path",
                "label": "SDXL checkpoint",
                "required": True,
            },
            # Optional: sd-scripts uses the checkpoint's own VAE unless one is
            # given (sdxl_train_util._load_target_model).
            {"key": "vae", "flag": "vae", "label": "VAE", "required": False},
        ],
        # SDXL is DDPM, not flow-matching — no timestep_sampling/flow_shift.
        "flow_matching": False,
        # SDXL's VAE is numerically unstable in fp16; keep it fp32 under mixed
        # precision (sd-scripts recommends --no_half_vae for bf16/fp16 SDXL).
        "no_half_vae": True,
        # No arch-specific static flags (Anima's --vae_chunk_size is not a valid
        # sdxl_train_network.py argument).
        "extra_args": [],
        # SDXL trains its two text encoders directly via --text_encoder_lr; no
        # special network arg is needed to unfreeze them.
        "te_network_args": [],
        "train_defaults": {
            "optimizer": "AdamW8bit",
            "lr": 1e-4,
            "dtype": "bf16",
            "resolution": [1024],
            "steps": 3000,
        },
    },
    {
        "id": "illustrious-xl",
        "name": "Illustrious XL",
        "architecture": "sdxl",
        "train_script": "sdxl_train_network.py",
        "network_module": "networks.lora",
        "components": [
            {
                "key": "checkpoint",
                "flag": "pretrained_model_name_or_path",
                "label": "Illustrious XL checkpoint",
                "required": True,
            },
            {"key": "vae", "flag": "vae", "label": "VAE", "required": False},
        ],
        "flow_matching": False,
        "no_half_vae": True,
        "extra_args": [],
        "te_network_args": [],
        "train_defaults": {
            "optimizer": "AdamW8bit",
            "lr": 1e-4,
            "dtype": "bf16",
            "resolution": [1024],
            "steps": 3000,
        },
    },
    {
        "id": "noob-ai-xl",
        "name": "NoobAI XL",
        "architecture": "sdxl",
        "train_script": "sdxl_train_network.py",
        "network_module": "networks.lora",
        "components": [
            {
                "key": "checkpoint",
                "flag": "pretrained_model_name_or_path",
                "label": "NoobAI XL checkpoint",
                "required": True,
            },
            {"key": "vae", "flag": "vae", "label": "VAE", "required": False},
        ],
        "flow_matching": False,
        "no_half_vae": True,
        "extra_args": [],
        "te_network_args": [],
        "train_defaults": {
            "optimizer": "AdamW8bit",
            "lr": 1e-4,
            "dtype": "bf16",
            "resolution": [1024],
            "steps": 3000,
        },
    },
    {
        "id": "anima",
        "name": "Anima",
        "architecture": "anima",
        # sd-scripts entry script for this architecture.
        "train_script": "anima_train_network.py",
        # LoRA network module implementing the Anima adapter.
        "network_module": "networks.lora_anima",
        "components": [
            {
                "key": "checkpoint",
                "flag": "pretrained_model_name_or_path",
                "label": "DiT checkpoint",
                "required": True,
            },
            {
                "key": "qwen",
                "flag": "qwen3",
                "label": "Qwen3 text encoder",
                "required": True,
            },
            {"key": "vae", "flag": "vae", "label": "VAE", "required": True},
        ],
        # Anima is flow-matching (Cosmos-Predict2 lineage).
        "flow_matching": True,
        "no_half_vae": False,
        # anima_train_network.py accepts --blocks_to_swap; sdxl_train_network.py
        # does not (verified against the local sd-scripts checkout).
        "supports_block_swap": True,
        # Qwen-Image VAE is memory-hungry at full frame; chunking keeps it
        # within budget (matches the sd-scripts Anima doc example).
        "extra_args": ["--vae_chunk_size=64"],
        # sd-scripts trains the Anima LLM adapter via a network arg.
        "te_network_args": ["train_llm_adapter=True"],
        "train_defaults": {
            "optimizer": "AdamW8bit",
            "lr": 1e-4,
            "dtype": "bf16",
            "resolution": [768, 1024],
            "steps": 2000,
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
        # Set by cancel_training() so the run loop can distinguish a
        # user-initiated stop from a genuine non-zero exit and stay quiet.
        self._cancelled = False

    async def validate_environment(self) -> tuple[bool, Optional[str]]:
        if not self._scripts_path.exists():
            return False, f"sd-scripts path does not exist: {self._scripts_path}"

        # Every supported model's train script must be present. Missing one
        # means this checkout can't train that architecture.
        for model in SUPPORTED_MODELS:
            script = self._scripts_path / model["train_script"]
            if not script.exists():
                return (
                    False,
                    f"sd-scripts checkout at {self._scripts_path} is missing "
                    f"{model['train_script']} — needed to train "
                    f"{model['name']}. Update to a checkout that includes it.",
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
        lines.append("")
        lines.append("[[datasets]]")
        lines.append(f"resolution = {max_res}")
        lines.append(f"batch_size = {int(hp.get('batch_size', 1))}")
        lines.append(f"enable_bucket = {_toml_bool(enable_bucket)}")
        if enable_bucket:
            bucket_no_upscale = bool(hp.get("bucket_no_upscale", False))
            bucket_reso_steps = int(hp.get("bucket_reso_steps", 64) or 64)
            lines.append(f"bucket_no_upscale = {_toml_bool(bucket_no_upscale)}")
            lines.append(f"bucket_reso_steps = {bucket_reso_steps}")
            lines.append(f"min_bucket_reso = {min_res}")
            lines.append(f"max_bucket_reso = {max_res}")
        lines.append("")

        # shuffle_caption / keep_tokens / caption_dropout_rate / flip_aug are
        # all "ascendable" subset params in sd-scripts (library/config_util.py
        # SUBSET_ASCENDABLE_SCHEMA / DO_SUBSET_ASCENDABLE_SCHEMA) — valid to set
        # per-[[datasets.subsets]] entry, which is what lets each dataset folder
        # carry its own augmentation settings. sd-scripts has no vertical-flip
        # augmentation, so ds.flip_v_augment is intentionally not used here.
        for ds in request.datasets:
            lines.append("[[datasets.subsets]]")
            lines.append(f"image_dir = {_toml_str(ds.path)}")
            lines.append(f"num_repeats = {int(ds.num_repeats)}")
            if ds.is_regularization:
                lines.append("is_reg = true")
            lines.append(f"shuffle_caption = {_toml_bool(ds.caption_shuffling)}")
            lines.append(f"keep_tokens = {int(ds.keep_tokens)}")
            caption_dropout = float(ds.caption_dropout_rate or 0)
            if caption_dropout > 0:
                lines.append(f"caption_dropout_rate = {caption_dropout}")
            if ds.flip_augment:
                lines.append("flip_aug = true")
            lines.append("")

        config_path = os.path.join(config_dir, f"{request.output_name}.toml")
        with open(config_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))

        return config_path

    def _build_cli_args(
        self, request: StartJobRequest, dataset_config: str, config_dir: str
    ) -> list[str]:
        """Translate the generic request into sd-scripts CLI flags.

        Model-specific differences (component paths, flow-matching controls,
        VAE handling, text-encoder wiring) come from the SUPPORTED_MODELS entry
        rather than being forked per architecture — the generic training args
        below are identical for every model.
        """
        model_def = _find_model(request.base_model)
        assert model_def is not None  # validated in generate_config
        hp = request.hyperparameters
        defaults = model_def["train_defaults"]

        model_paths = hp.get("model_paths") or {}

        # Resolve each declared component to its CLI flag. The checkpoint also
        # falls back to the flat `model_path` hyperparameter.
        component_args: list[str] = []
        missing: list[str] = []
        for comp in model_def["components"]:
            path = model_paths.get(comp["key"])
            if comp["key"] == "checkpoint" and not path:
                path = hp.get("model_path")
            if path:
                component_args.append(f"--{comp['flag']}={path}")
            elif comp["required"]:
                missing.append(comp["label"])
        if missing:
            raise ValueError(
                f"{model_def['name']} training needs: " + ", ".join(missing)
            )

        train_text_encoder = bool(hp.get("train_text_encoder", False))
        optimizer = _OPTIMIZER_MAP.get(
            str(hp.get("optimizer", "adamw8bit")).lower(), "AdamW8bit"
        )

        args: list[str] = [
            *component_args,
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
        ]

        # Flow-matching controls (Anima). SDXL is DDPM and its train script
        # does not accept these flags, so they're gated on the model entry.
        if model_def.get("flow_matching"):
            args.append(
                f"--timestep_sampling={hp.get('timestep_type', defaults.get('timestep_sampling', 'sigmoid'))}"
            )
            # hp override wins over the model entry's default.
            args.append(
                f"--discrete_flow_shift={_num(hp.get('discrete_flow_shift', defaults.get('discrete_flow_shift', 1.0)))}"
            )

        # Min-SNR loss weighting and noise offset are DDPM-only mechanisms —
        # Anima (flow-matching) overrides post_process_loss to a no-op and
        # samples noise without an offset, so these flags are inert on that
        # path. Still safe to emit generically since sd-scripts' base
        # train_network.py owns both regardless of architecture; the UI hides
        # them for Anima so users aren't misled into thinking they do
        # anything there.
        if float(hp.get("min_snr_gamma", 0) or 0) > 0:
            args.append(f"--min_snr_gamma={_num(hp['min_snr_gamma'])}")
        if float(hp.get("noise_offset", 0) or 0) > 0:
            args.append(f"--noise_offset={_num(hp['noise_offset'])}")

        # Keep the VAE in fp32 for archs whose VAE is fp16-unstable (SDXL).
        if model_def.get("no_half_vae"):
            args.append("--no_half_vae")

        # Static per-arch extras (e.g. Anima's --vae_chunk_size).
        args.extend(model_def.get("extra_args", []))

        # Optimizer args (--optimizer_args is nargs=*). Start with our
        # weight_decay emission, then merge the user's freeform expert pairs.
        # If the user supplied their own weight_decay (or any key we also emit),
        # theirs wins — drop our duplicate so argparse doesn't see the key twice.
        optimizer_args: list[str] = []
        if float(hp.get("weight_decay", 0) or 0) > 0 and optimizer in (
            "AdamW",
            "AdamW8bit",
        ):
            optimizer_args.append(f'weight_decay={_num(hp["weight_decay"])}')
        user_optimizer_args = _parse_kv_args(hp.get("optimizer_args", ""))
        user_keys = {a.split("=", 1)[0] for a in user_optimizer_args}
        optimizer_args = [
            a for a in optimizer_args if a.split("=", 1)[0] not in user_keys
        ]
        optimizer_args.extend(user_optimizer_args)
        if optimizer_args:
            args.append("--optimizer_args")
            args.extend(optimizer_args)

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

        # Cap LoRA weight norms (generic train_network.py option, applies to
        # every architecture regardless of flow-matching/DDPM).
        if float(hp.get("scale_weight_norms", 0) or 0) > 0:
            args.append(f"--scale_weight_norms={_num(hp['scale_weight_norms'])}")

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

        # Text encoder handling. When training it, wire an LR through and add
        # any arch-specific network arg (Anima unfreezes its Qwen3 LLM adapter
        # via train_llm_adapter=True; SDXL trains its two text encoders
        # directly). When frozen, restrict the LoRA to the UNet/DiT and — when
        # safe — cache the TE outputs for a big VRAM/time win.
        # --network_args (nargs=*): arch-specific TE args when the text encoder
        # is trained, plus any user-supplied freeform expert pairs. Collected
        # here and emitted once below.
        network_args: list[str] = []
        if train_text_encoder:
            te_lr = hp.get("text_encoder_lr", 0) or 0
            if float(te_lr) > 0:
                args.append(f"--text_encoder_lr={_num(te_lr)}")
            network_args.extend(model_def.get("te_network_args") or [])
        else:
            # network_train_unet_only is a precondition for TE-output caching
            # (sd-scripts asserts it), and is correct regardless: a frozen TE
            # can't carry trainable LoRA weights.
            args.append("--network_train_unet_only")
            # sd-scripts asserts (sdxl_train_network.assert_extra_args ->
            # dataset.is_text_encoder_output_cacheable) that TE-output caching
            # is incompatible with caption shuffling or a caption dropout rate
            # > 0 — a cached embedding can't reflect a shuffled/dropped caption.
            # Only cache when no subset uses either, else the run aborts at
            # startup. This matters now that shuffle/dropout are per-subset live.
            if _te_cache_safe(request.datasets):
                args.append("--cache_text_encoder_outputs")

        # User pairs win over arch defaults on key collision (same policy as
        # the weight_decay dedup in --optimizer_args).
        user_network_args = _parse_kv_args(hp.get("network_args", ""))
        user_keys = {pair.split("=", 1)[0] for pair in user_network_args}
        network_args = [
            pair for pair in network_args if pair.split("=", 1)[0] not in user_keys
        ]
        network_args.extend(user_network_args)
        if network_args:
            args.append("--network_args")
            args.extend(network_args)

        # Block swap (anima only): offload N transformer blocks to CPU to cut
        # VRAM. Gated on the model entry — sdxl_train_network.py rejects the
        # flag, so it's hidden in the UI and skipped here for non-supporting
        # architectures.
        blocks_to_swap = int(hp.get("blocks_to_swap", 0) or 0)
        if blocks_to_swap > 0 and model_def.get("supports_block_swap"):
            args.append(f"--blocks_to_swap={blocks_to_swap}")

        # NOTE: --fp8_base is deliberately NOT emitted — the UI hides the
        # quantization fields for these models accordingly (Anima has no fp8
        # support; SDXL fits comfortably at bf16).

        # Checkpoint saving. The user picks either a step or epoch cadence; the
        # Node side sends whichever is non-zero (steps take precedence). sd-scripts
        # measures its rolling-keep window in the same unit as the save interval,
        # so `--save_last_n_steps` is a step count (interval × count), whereas
        # `--save_last_n_epochs` is a plain checkpoint count.
        save_every_steps = int(hp.get("save_every_n_steps", 0) or 0)
        save_every_epochs = int(hp.get("save_every_n_epochs", 0) or 0)
        max_keep = int(hp.get("max_saves_to_keep", 0) or 0)
        if save_every_steps > 0:
            args.append(f"--save_every_n_steps={save_every_steps}")
            if max_keep > 0:
                args.append(f"--save_last_n_steps={save_every_steps * max_keep}")
        elif save_every_epochs > 0:
            args.append(f"--save_every_n_epochs={save_every_epochs}")
            if max_keep > 0:
                args.append(f"--save_last_n_epochs={max_keep}")

        # Sample generation during training.
        if request.sample_prompts:
            resolution = hp.get("resolution", defaults.get("resolution", [1024]))
            if not isinstance(resolution, list):
                resolution = [int(resolution)]
            sample_res = max(resolution) if resolution else 1024
            sample_steps = int(
                hp.get("sample_steps", defaults.get("sample_steps", 20))
            )
            sample_guidance = _num(
                hp.get("guidance_scale", defaults.get("guidance_scale", 7))
            )

            prompt_lines = [
                _add_missing_sample_flags(
                    prompt, sample_res, sample_res, sample_steps, sample_guidance
                )
                for prompt in request.sample_prompts
            ]

            prompt_file = os.path.join(
                config_dir, f"{request.output_name}.sample-prompts.txt"
            )
            with open(prompt_file, "w", encoding="utf-8") as f:
                f.write("\n".join(prompt_lines))
            args.append(f"--sample_prompts={prompt_file}")
            args.append(
                f"--sample_every_n_steps={int(hp.get('sample_every_n_steps', 250))}"
            )
            args.append(
                f"--sample_sampler={hp.get('sample_sampler', 'euler_a')}"
            )

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

        self._cancelled = False
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
        # Hold a local handle: cancel_training() nulls self._process, and the
        # tail of this loop must still be able to await the exit code.
        proc = self._process

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
                    # Record saves at the step the bar is frozen on. sd-scripts
                    # prints "saving checkpoint: <file>" for every intermediate
                    # epoch/step save (train_network.py, immediately before the
                    # write) but "model saved." only once, for the final model —
                    # so the intermediate line is the save signal, with "model
                    # saved" catching the run-end save. The manager dedupes by
                    # step, which also collapses the final-epoch save and the
                    # end-of-run save landing on the same step.
                    saved: list[int] = []
                    if "saving checkpoint" in lower or "saving model" in lower:
                        activity = "Saving checkpoint"
                        saved = [current_step]
                    elif "generating sample" in lower or (
                        "sample" in lower and "generat" in lower
                    ):
                        activity = "Generating samples"
                    elif "model saved" in lower:
                        activity = "Checkpoint saved"
                        saved = [current_step]
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
                            saved_checkpoints=saved,
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
        return_code = await proc.wait()
        self._process = None

        # User asked to stop: cancel_job() emits the CANCELLED update, so the
        # non-zero exit from the kill is expected — don't report it as a failure.
        if self._cancelled:
            return

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
        self._cancelled = True
        proc = self._process
        if proc is None:
            return

        if sys.platform == "win32":
            # accelerate spawns child worker processes; kill the whole tree.
            os.system(f"taskkill /F /T /PID {proc.pid}")
        else:
            proc.send_signal(signal.SIGTERM)

        try:
            await asyncio.wait_for(proc.wait(), timeout=10)
        except asyncio.TimeoutError:
            proc.kill()

        self._process = None

    def get_supported_models(self) -> list[dict]:
        return [
            {"id": m["id"], "name": m["name"], "architecture": m["architecture"]}
            for m in SUPPORTED_MODELS
        ]


# --- Helpers ---


def _te_cache_safe(datasets) -> bool:
    """Whether it's safe to emit --cache_text_encoder_outputs.

    sd-scripts refuses to cache text-encoder outputs when any subset uses
    caption shuffling or a caption dropout rate > 0 (the cached embedding is
    computed once and can't reflect a per-step shuffled/dropped caption). The
    check lives in dataset.is_text_encoder_output_cacheable, gated from
    <arch>_train_network.assert_extra_args. We only ever set shuffle_caption
    and caption_dropout_rate in our generated TOML (never token_warmup_step or
    caption_tag_dropout_rate), so those two are the only conditions to mirror.
    """
    for ds in datasets:
        if ds.caption_shuffling:
            return False
        if float(ds.caption_dropout_rate or 0) > 0:
            return False
    return True


def _prompt_line_has_flag(line: str, flag: str) -> bool:
    r"""Whether `line` already sets `--{flag}` in sd-scripts prompt-line syntax.

    Mirrors library/sampling.py's line_to_prompt_dict: a prompt line is split
    on " --" and each resulting segment matched against e.g. `r"w (\d+)"` at
    its start — so we replicate that same split/prefix check rather than a
    naive substring search (which would e.g. mistake "--ss euler_a" for a "-s"
    steps flag).
    """
    for segment in line.split(" --")[1:]:
        m = re.match(r"^(\w+)\s", segment)
        if m and m.group(1).lower() == flag:
            return True
    return False


def _add_missing_sample_flags(
    line: str, width: int, height: int, steps: int, guidance: str
) -> str:
    """Append `--w`/`--h`/`--s`/`--l` to a sample prompt line, unless the user
    already set that flag on the line themselves (their explicit choice wins).
    """
    extras: list[str] = []
    if not _prompt_line_has_flag(line, "w"):
        extras.append(f"--w {width}")
    if not _prompt_line_has_flag(line, "h"):
        extras.append(f"--h {height}")
    if not _prompt_line_has_flag(line, "s"):
        extras.append(f"--s {steps}")
    if not _prompt_line_has_flag(line, "l"):
        extras.append(f"--l {guidance}")
    if not extras:
        return line
    return line + " " + " ".join(extras)


def _parse_kv_args(raw) -> list[str]:
    """Parse a freeform "key=value key2=value2" string into a list of chunks.

    Splits on whitespace and keeps only chunks that contain '=' (a bare key
    with no value, or stray tokens, are silently dropped — the UI surfaces a
    non-blocking hint for malformed input). Used for the expert-tier
    --network_args / --optimizer_args editors.
    """
    if not raw:
        return []
    return [chunk for chunk in str(raw).split() if "=" in chunk]


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
