"""Kohya (sd-scripts) training provider.

Covers SDXL (plus its Illustrious/NoobAI finetunes), Anima — the
Cosmos-Predict2-based anime DiT supported in mainline kohya-ss/sd-scripts via
`anima_train_network.py` — and Flux.1 Dev/Schnell via `flux_train_network.py`
(a second backend for the models ai-toolkit already trains, loading the same
four single-file weights). Multi-file archs need each model path explicitly —
unlike ai-toolkit which takes a single checkpoint and resolves the rest.

Training is launched with `accelerate launch <arch>_train_network.py ...` as a
subprocess and progress is scraped from sd-scripts' tqdm output. All of that —
the spawn, the log grammar, the training-loop state machine, cancellation — is
shared with any other sd-scripts-lineage backend and lives in
`providers/sd_scripts_base.py`. What stays here is the model catalogue, the
dataset TOML, and the CLI-flag translation.
"""

import os
from pathlib import Path
from typing import Optional

from models import StartJobRequest
from providers.sd_scripts_base import (
    _OPTIMIZER_MAP,
    _SAVE_PRECISION_MAP,
    SdScriptsProvider,
    _find_python,
    _num,
    _parse_kv_args,
    _parse_native_resolution,
    _toml_bool,
    _toml_str,
)

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
    # Flux.1 Dev/Schnell — second backend for models that also train on
    # ai-toolkit. flux_train_network.py takes the four single-file weights
    # (DiT checkpoint, CLIP-L, T5-XXL, AE) as separate flags; the same files
    # the ai-toolkit path already downloads.
    {
        "id": "flux-dev",
        "name": "Flux.1 Dev",
        "architecture": "flux",
        "train_script": "flux_train_network.py",
        "network_module": "networks.lora_flux",
        "components": [
            {
                "key": "checkpoint",
                "flag": "pretrained_model_name_or_path",
                "label": "Flux.1 checkpoint",
                "required": True,
            },
            {
                "key": "clip_l",
                "flag": "clip_l",
                "label": "CLIP-L text encoder",
                "required": True,
            },
            {
                "key": "t5",
                "flag": "t5xxl",
                "label": "T5-XXL text encoder",
                "required": True,
            },
            {"key": "ae", "flag": "ae", "label": "Autoencoder", "required": True},
        ],
        "flow_matching": True,
        "no_half_vae": False,
        "supports_block_swap": True,
        # docs/flux_train_network.md: "up to 35 blocks" (double + single).
        "max_blocks_to_swap": 35,
        # sd-scripts' fp8 path is how the doc's 16 GB configuration works
        # (--fp8_base + block swap); see the fp8 emission in _build_cli_args.
        "supports_fp8": True,
        # Flux sampling reads embedded guidance from `--g`; `--l` is real CFG
        # and defaults to 1.0 (off) when absent, which is what dev wants.
        "sample_guidance_flag": "g",
        # flux_train_network's sampler lookup is commented out upstream —
        # sampling is hard-wired flow-matching Euler, so don't emit the flag.
        "supports_sample_sampler": False,
        # The doc's recommended combo: shift sampling at 3.1582 with raw
        # prediction. --guidance_scale is the *training-time* embedded
        # guidance conditioning, which must be 1.0 for dev.
        "extra_args": ["--model_prediction_type=raw", "--guidance_scale=1.0"],
        "te_network_args": [],
        "train_defaults": {
            "optimizer": "AdamW8bit",
            "lr": 1e-4,
            "dtype": "bf16",
            "resolution": [512, 768, 1024],
            "steps": 2000,
            "timestep_sampling": "shift",
            "discrete_flow_shift": 3.1582,
            "guidance_scale": 4,
            "sample_steps": 20,
        },
    },
    {
        "id": "flux-schnell",
        "name": "Flux.1 Schnell",
        "architecture": "flux",
        "train_script": "flux_train_network.py",
        "network_module": "networks.lora_flux",
        "components": [
            {
                "key": "checkpoint",
                "flag": "pretrained_model_name_or_path",
                "label": "Flux.1 checkpoint",
                "required": True,
            },
            {
                "key": "clip_l",
                "flag": "clip_l",
                "label": "CLIP-L text encoder",
                "required": True,
            },
            {
                "key": "t5",
                "flag": "t5xxl",
                "label": "T5-XXL text encoder",
                "required": True,
            },
            {"key": "ae", "flag": "ae", "label": "Autoencoder", "required": True},
        ],
        "flow_matching": True,
        "no_half_vae": False,
        "supports_block_swap": True,
        "max_blocks_to_swap": 35,
        "supports_fp8": True,
        "sample_guidance_flag": "g",
        "supports_sample_sampler": False,
        # Schnell takes the guidance input but was distilled without it doing
        # anything useful — 1.0 is the conventional training value, same as dev.
        "extra_args": ["--model_prediction_type=raw", "--guidance_scale=1.0"],
        "te_network_args": [],
        "train_defaults": {
            "optimizer": "AdamW8bit",
            "lr": 1e-4,
            "dtype": "bf16",
            "resolution": [512, 768, 1024],
            "steps": 1500,
            "timestep_sampling": "shift",
            "discrete_flow_shift": 3.1582,
            # Schnell samples in 4 steps with guidance effectively off.
            "guidance_scale": 1,
            "sample_steps": 4,
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

# Smallest bucket edge offered when the run has a single training resolution.
# sd-scripts' own default; wide enough to hold the short edge of an extreme
# aspect ratio without upscaling it to the training size.
DEFAULT_MIN_BUCKET_RESO = 256


def _find_model(model_id: str) -> Optional[dict]:
    for m in SUPPORTED_MODELS:
        if m["id"] == model_id:
            return m
    return None


def _resolution_list(hp: dict, defaults: dict) -> list[int]:
    """The run's training resolutions, always as a list of ints."""
    resolution = hp.get("resolution", defaults.get("resolution", [1024]))
    if not isinstance(resolution, list):
        resolution = [int(resolution)]
    return resolution


class KohyaProvider(SdScriptsProvider):
    """Training provider backed by kohya-ss/sd-scripts."""

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
        self, request: StartJobRequest, config_dir: str, job_id: str
    ) -> str:
        """Write the sd-scripts dataset config TOML and return its path.

        sd-scripts takes datasets via a TOML file (`--dataset_config`) rather
        than CLI flags. The training-loop flags themselves are assembled in
        `_build_cli_args`.

        This is also where a hybrid dataset's captions are composed for the run
        (see `composed_captions`), because the subset that reads them is written
        here.
        """
        model_def = _find_model(request.base_model)
        if model_def is None:
            raise ValueError(f"Unknown model: {request.base_model}")

        hp = request.hyperparameters
        defaults = model_def["train_defaults"]

        resolution = _resolution_list(hp, defaults)
        max_res = max(resolution) if resolution else 1024
        min_res = min(resolution) if resolution else max_res

        # An exact WxH size overrides the resolution list outright: bucketing
        # off, no resize, no crop. Images already at WxH reach the VAE byte-for-
        # byte, which is the only way to train pixel art without a resample
        # smearing the pixel grid.
        native = _parse_native_resolution(hp.get("native_resolution"))

        # Bucket unless the user pinned an exact size. A single training
        # resolution used to disable bucketing, which made sd-scripts resize-
        # and-centre-crop every non-square image — silently cropping subjects
        # out of frame, and diverging from ai-toolkit (which always buckets).
        # Aspect-ratio bucketing at one resolution is the normal way to train.
        enable_bucket = not native
        # Multi-resolution runs bucket between the smallest and largest chosen
        # size; a single-resolution run buckets from the standard floor up to
        # that size (clamped, in case someone trains below the floor).
        min_bucket_reso = (
            min_res
            if len(resolution) > 1
            else min(DEFAULT_MIN_BUCKET_RESO, max_res)
        )

        lines: list[str] = []
        lines.append("[general]")
        lines.append('caption_extension = ".txt"')
        lines.append("")
        lines.append("[[datasets]]")
        if native:
            lines.append(f"resolution = [{native[0]}, {native[1]}]")
        else:
            lines.append(f"resolution = {max_res}")
        lines.append(f"batch_size = {int(hp.get('batch_size', 1))}")
        lines.append(f"enable_bucket = {_toml_bool(enable_bucket)}")
        if enable_bucket:
            bucket_no_upscale = bool(hp.get("bucket_no_upscale", False))
            bucket_reso_steps = int(hp.get("bucket_reso_steps", 64) or 64)
            lines.append(f"bucket_no_upscale = {_toml_bool(bucket_no_upscale)}")
            lines.append(f"bucket_reso_steps = {bucket_reso_steps}")
            lines.append(f"min_bucket_reso = {min_bucket_reso}")
            lines.append(f"max_bucket_reso = {max_res}")
        lines.append("")

        # Compose hybrid captions into run-scoped files beside the images, and
        # point the subsets that got them at the extension they were written
        # under. `caption_extension` is in DB_SUBSET_ASCENDABLE_SCHEMA
        # (library/config_util.py:212) and our subsets are DreamBooth-shaped
        # (image_dir + is_reg), so a per-subset override is valid; folders with
        # no hybrid captions are absent from the mapping and inherit the
        # `.txt` set under [general].
        caption_extensions = self._compose_captions(request, job_id)

        # shuffle_caption / keep_tokens / caption_dropout_rate / flip_aug are
        # all "ascendable" subset params in sd-scripts (library/config_util.py
        # SUBSET_ASCENDABLE_SCHEMA / DO_SUBSET_ASCENDABLE_SCHEMA) — valid to set
        # per-[[datasets.subsets]] entry, which is what lets each dataset folder
        # carry its own augmentation settings. sd-scripts has no vertical-flip
        # augmentation, so ds.flip_v_augment is intentionally not used here.
        for index, ds in enumerate(request.datasets):
            lines.append("[[datasets.subsets]]")
            lines.append(f"image_dir = {_toml_str(ds.path)}")
            lines.append(f"num_repeats = {int(ds.num_repeats)}")
            extension = caption_extensions.get(index)
            if extension:
                lines.append(f"caption_extension = {_toml_str(extension)}")
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

        # Duration: let sd-scripts count epochs itself when that's the unit the
        # user chose. The client can only *estimate* the step equivalent of an
        # epoch — it assumes ceil(images / batch), but sd-scripts batches within
        # aspect-ratio buckets, so each bucket rounds its own partial batch up
        # and the real steps-per-epoch is higher. Passing that short estimate as
        # --max_train_steps silently truncates the run mid-epoch (80 requested
        # epochs finishing as 77). --max_train_epochs makes sd-scripts derive
        # the step total from its own dataloader, which is the only place the
        # true bucket layout is known.
        epochs = int(hp.get("epochs", 0) or 0)
        if str(hp.get("duration_mode", "steps")) == "epochs" and epochs > 0:
            duration_arg = f"--max_train_epochs={epochs}"
        else:
            duration_arg = (
                f"--max_train_steps={int(hp.get('steps', defaults.get('steps', 2000)))}"
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
            duration_arg,
            f"--train_batch_size={int(hp.get('batch_size', 1))}",
            f"--gradient_accumulation_steps={int(hp.get('gradient_accumulation_steps', 1))}",
            f"--mixed_precision={hp.get('mixed_precision', defaults.get('dtype', 'bf16'))}",
            f"--save_precision={_SAVE_PRECISION_MAP.get(hp.get('save_format', 'fp16'), 'fp16')}",
            f"--max_grad_norm={_num(hp.get('max_grad_norm', 1.0))}",
        ]

        # Plain-text logging instead of rich. sd-scripts' default RichHandler
        # renders each record as separate column writes (timestamp, level,
        # message, right-aligned "dataset.py:464" gutter). Several DataLoader
        # workers share one stderr fd, so those partial writes interleave in the
        # pipe and reach us spliced together mid-line — unparseable, and immune
        # to `_append_log_line`'s repeat collapsing because no two shredded
        # lines compare equal. --console_log_simple swaps in a StreamHandler
        # with fmt="%(message)s": one write per line, no decoration, so worker
        # repeats become byte-identical and collapse as intended. Side effect:
        # library logging moves from stderr to stdout (both are read here), and
        # lines lose their wall-clock timestamp.
        args.append("--console_log_simple")

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

        # fp8 quantisation (Flux only; Anima has no fp8 support and SDXL fits
        # comfortably at bf16 — the UI hides the quantization fields for those
        # models). sd-scripts has two granularities: --fp8_base quantises the
        # DiT *and* both text encoders, --fp8_base_unet keeps the TEs in
        # bf16/fp16 while the DiT goes fp8 — mapped from the app's separate
        # transformer/TE quantisation fields.
        if model_def.get("supports_fp8"):
            transformer_fp8 = hp.get("transformer_quantization") == "float8"
            te_fp8 = hp.get("text_encoder_quantization") == "float8"
            if transformer_fp8 and te_fp8:
                args.append("--fp8_base")
            elif transformer_fp8:
                args.append("--fp8_base_unet")

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
            args.extend(self._sample_args(request, config_dir, model_def))

        # Resume from a saved training state directory.
        if hp.get("resume_state"):
            args.append(f"--resume={hp['resume_state']}")
        if hp.get("save_state", False):
            args.append("--save_state")

        return args

    def _sample_args(
        self, request: StartJobRequest, config_dir: str, model_def: dict
    ) -> list[str]:
        """Write the sample-prompt file and return the sampling CLI flags."""
        hp = request.hyperparameters
        defaults = model_def["train_defaults"]

        resolution = _resolution_list(hp, defaults)
        sample_res = max(resolution) if resolution else 1024
        # Samples default to the training size, so an exact WxH run samples
        # at WxH rather than a square crop of it.
        native = _parse_native_resolution(hp.get("native_resolution"))
        sample_w, sample_h = native if native else (sample_res, sample_res)
        sample_steps = int(hp.get("sample_steps", defaults.get("sample_steps", 20)))
        sample_guidance = _num(
            hp.get("guidance_scale", defaults.get("guidance_scale", 7))
        )

        # Per-prompt sizes override the run default where the UI supplied
        # them; a short/absent list leaves the older behaviour intact.
        # Flux prompt lines carry embedded guidance as `--g` (`--l` is real
        # CFG, defaulting off) — the SDXL family uses `--l` for CFG.
        guidance_flag = model_def.get("sample_guidance_flag")
        prompt_lines = []
        for i, prompt in enumerate(request.sample_prompts):
            width, height = request.sample_size_at(i, sample_w, sample_h)
            prompt_lines.append(
                self._add_missing_sample_flags(
                    prompt,
                    width,
                    height,
                    sample_steps,
                    sample_guidance,
                    guidance_flag,
                )
            )

        prompt_file = os.path.join(
            config_dir, f"{request.output_name}.sample-prompts.txt"
        )
        with open(prompt_file, "w", encoding="utf-8") as f:
            f.write("\n".join(prompt_lines))

        args = [f"--sample_prompts={prompt_file}"]
        # Sampling cadence in exactly one unit — mirrors the save-cadence
        # dual field above. sd-scripts supports --sample_every_n_epochs
        # natively, so pass whichever unit the user chose (the Node side
        # zeroes the other). Epoch cadence wins when set.
        sample_every_steps = int(hp.get("sample_every_n_steps", 0) or 0)
        sample_every_epochs = int(hp.get("sample_every_n_epochs", 0) or 0)
        if sample_every_epochs > 0:
            args.append(f"--sample_every_n_epochs={sample_every_epochs}")
        else:
            args.append(f"--sample_every_n_steps={sample_every_steps or 250}")
        # Flux's sampler lookup is commented out upstream (always flow-matching
        # Euler), so the flag is only emitted where it's actually consulted.
        if model_def.get("supports_sample_sampler", True):
            args.append(f"--sample_sampler={hp.get('sample_sampler', 'euler_a')}")
        return args

    def _train_command(
        self, request: StartJobRequest, config_path: str
    ) -> tuple[str, str, list[str], str]:
        """The accelerate launch pieces for this run."""
        model_def = _find_model(request.base_model)
        if model_def is None:
            raise ValueError(f"Unknown model: {request.base_model}")

        python_exe = _find_python(self._scripts_path)
        script = str(self._scripts_path / model_def["train_script"])
        config_dir = os.path.dirname(config_path)
        cli_args = self._build_cli_args(request, config_path, config_dir)
        return python_exe, script, cli_args, str(self._scripts_path)

    def get_supported_models(self) -> list[dict]:
        return [
            {"id": m["id"], "name": m["name"], "architecture": m["architecture"]}
            for m in SUPPORTED_MODELS
        ]

    def validate_request(self, request: StartJobRequest) -> list[str]:
        """Cheap semantic checks: native resolution shape, component paths.

        Unknown-model is deliberately not reported here — validation.py
        already checks base_model membership against get_supported_models(),
        so a None here just means there's nothing arch-specific left to check.
        """
        errors: list[str] = []
        hp = request.hyperparameters

        native = hp.get("native_resolution")
        if native:
            try:
                _parse_native_resolution(native)
            except ValueError as e:
                errors.append(str(e))

        model_def = _find_model(request.base_model)
        if model_def is None:
            return errors

        blocks_to_swap = int(hp.get("blocks_to_swap", 0) or 0)
        max_swap = model_def.get("max_blocks_to_swap")
        if max_swap is not None and blocks_to_swap > max_swap:
            errors.append(
                f"{model_def['name']} supports at most {max_swap} swapped "
                f"blocks (got {blocks_to_swap})"
            )

        model_paths = hp.get("model_paths") or {}
        for comp in model_def["components"]:
            path = model_paths.get(comp["key"])
            if comp["key"] == "checkpoint" and not path:
                path = hp.get("model_path")
            if not path:
                if comp["required"]:
                    errors.append(
                        f"{model_def['name']} training needs: {comp['label']}"
                    )
                continue
            if not Path(path).exists():
                errors.append(f"{comp['label']} path does not exist: {path}")

        return errors


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
