"""Shared ai-toolkit model registry and config helpers.

The base-model catalogue and the handful of hyperparameter-resolution helpers
below are backend knowledge rather than provider plumbing, so they live apart
from the provider that consumes them (`ai_toolkit_ui`). They were previously
carried by a CLI-driven `AiToolkitProvider` that the sidecar stopped
registering when the UI-server provider replaced it; that class is gone, and
these are what outlived it.
"""

from typing import Optional

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
            # Distilled base trained through the de-distilling adapter: even a
            # small dataset is only starting to take at ~2,000 steps.
            "steps": 4000,
            # Turbo is guidance-distilled — the reference recipe is 8 steps at
            # CFG off. ai-toolkit's zimage sampler passes
            # `max(0, guidance_scale - 1)` to a pipeline whose CFG is
            # 0-normalised (`pred = pos + scale * (pos - neg)`), so 1 here is
            # what disables it. Anything higher runs real CFG: two transformer
            # passes per sample step, off-recipe output.
            "guidance_scale": 1,
            "sample_steps": 8,
            # ai-toolkit's own Z-Image presets use `weighted`; `sigmoid` is the
            # value they set for non-Z-Image archs.
            "timestep_type": "weighted",
        },
    },
    # Krea 2 RAW — also trains on the musubi backend from the same single-file
    # DiT. ai-toolkit's Krea2Model accepts a bare .safetensors path (its
    # custom loader reads the MMDiT state dict directly). Its TE
    # (Qwen/Qwen3-VL-4B-Instruct) and VAE (Qwen/Qwen-Image) default to HF-hub
    # downloads, overridable per `model_kwargs_paths` below — the client sends
    # local HF-format directories under those component keys when the user has
    # them installed; absent keys fall back to the hub fetch. RAW is the musubi
    # route as well; the distilled Turbo checkpoint trains through an assistant
    # LoRA and is the separate `krea2-turbo` entry below.
    {
        "id": "krea2",
        "name": "Krea 2",
        "architecture": "krea2",
        "model_path": "krea/Krea-2-Raw",
        "config": {"arch": "krea2", "quantize": True},
        # model.model_kwargs entry <- hp["model_paths"] component key. Only
        # emitted when the client sent a path for the component (see
        # `resolve_model_kwargs`).
        "model_kwargs_paths": {
            "text_encoder_path": "te_repo",
            "vae_path": "vae_repo",
        },
        # Legacy fallback only — layer offloading is normally driven by the
        # client's layerOffloadPercent field (krea2 defaults to 100 there).
        # This kicks in for requests predating that field (job resumes) when
        # low_vram is on. Why offloading at all: Krea 2's fp8 DiT is
        # ~12.3 GB resident — ModelConfig.low_vram alone only parks it on
        # CPU *between* phases, so on a 16 GB card training spills into
        # driver sysmem fallback (~4 min/step measured; 50% offload still
        # spilled on backward-pass activation peaks at ~79 s/step). Full
        # streaming matches ai-toolkit's own UI slider default.
        "low_vram_layer_offloading": {"transformer_percent": 1.0},
        "train_defaults": {
            "noise_scheduler": "flowmatch",
            "optimizer": "adamw8bit",
            "lr": 1e-4,
            "dtype": "bf16",
            "resolution": [1024],
            "steps": 2500,
            # Krea's reference guidance is offset by one (official 4.5 == 5.5
            # here); RAW samples want real CFG.
            "guidance_scale": 5.5,
            "sample_steps": 28,
            # ai-toolkit's own krea2 UI preset sets `linear` — fallback only,
            # the client always sends the app-level default.
            "timestep_type": "linear",
        },
    },
    # Krea 2 Turbo — the distilled checkpoint, trainable only through
    # ai-toolkit's assistant LoRA (client sends it as the `training_adapter`
    # component -> `model.assistant_lora_path`; Krea2Model merges it at +1.0
    # for training and applies it at -1.0 while sampling). Same arch class as
    # RAW: ModelConfig strips the `:turbo` suffix ai-toolkit's own UI uses
    # (config_modules.py), so it is cosmetic and we don't send it.
    {
        "id": "krea2-turbo",
        "name": "Krea 2 Turbo",
        "architecture": "krea2",
        "model_path": "krea/Krea-2-Turbo",
        "config": {"arch": "krea2", "quantize": True},
        "model_kwargs_paths": {
            "text_encoder_path": "te_repo",
            "vae_path": "vae_repo",
        },
        # As for RAW: same ~12.3 GB fp8 DiT, same 16 GB budget.
        "low_vram_layer_offloading": {"transformer_percent": 1.0},
        "train_defaults": {
            "noise_scheduler": "flowmatch",
            "optimizer": "adamw8bit",
            "lr": 1e-4,
            "dtype": "bf16",
            "resolution": [1024],
            "steps": 2500,
            # Guidance-distilled: the reference recipe is 9 steps at CFG off.
            # The krea2 sampler passes `max(0, guidance_scale - 1)` to a
            # 0-normalised CFG pipeline, so 1 here is what disables it.
            "guidance_scale": 1,
            "sample_steps": 9,
            "timestep_type": "linear",
        },
    },
    # Anima also trains on the kohya backend, but from a different set of
    # weights: kohya takes the single-file DiT + Qwen3 TE + VAE, while
    # ai-toolkit builds the modular diffusers pipeline from a directory (see
    # `extensions_built_in/diffusion_models/anima/anima.py` — `init_pipeline`
    # then `load_components`, with no single-file path). The client sends the
    # pipeline directory as `model_path`; the HF fallback below is the same
    # repo ai-toolkit's own UI defaults to.
    {
        "id": "anima",
        "name": "Anima",
        "architecture": "anima",
        "model_path": "circlestone-labs/Anima-Base-v1.0-Diffusers",
        "config": {"arch": "anima"},
        "train_defaults": {
            "noise_scheduler": "flowmatch",
            "optimizer": "adamw8bit",
            "lr": 1e-4,
            "dtype": "bf16",
            "resolution": [768, 1024],
            # 1,600 at 5e-5 comes out under-baked in practice; ~2,400-3,200 at
            # 1e-4 is where the concept actually lands.
            "steps": 2800,
            # ai-toolkit's own Anima preset sets `weighted` when the arch is
            # selected (`ui/src/app/jobs/new/options.ts`), against the
            # `sigmoid` it uses for other archs.
            "timestep_type": "weighted",
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
        "model_path": "Lightricks/LTX-2",
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

def find_model(model_id: str) -> Optional[dict]:
    for m in SUPPORTED_MODELS:
        if m["id"] == model_id:
            return m
    return None

# --- Config helpers ---

def resolve_model_kwargs(model_def: dict, hp: dict) -> dict:
    """The `model.model_kwargs` block for models that take path overrides.

    `model_kwargs_paths` on a catalogue entry maps a Krea2Model-style
    model_kwargs key (e.g. `text_encoder_path`) to the `hp["model_paths"]`
    component the client sends it under (e.g. `te_repo`). Components the
    client didn't send are simply absent — ai-toolkit then falls back to its
    own HF-hub download for that piece, so a user without the local copies
    still trains.
    """
    model_paths = hp.get("model_paths") or {}
    kwargs = {}
    for kwarg, component in (model_def.get("model_kwargs_paths") or {}).items():
        path = model_paths.get(component)
        if path:
            kwargs[kwarg] = path
    return kwargs


def steps_per_epoch(save_every_n_epochs: int, epochs: int, total_steps: int) -> int:
    """Convert save-every-N-epochs to save-every-N-steps."""
    if epochs <= 0:
        return total_steps
    steps_per_epoch = total_steps // epochs
    return max(1, steps_per_epoch * save_every_n_epochs)


def resolve_save_every_steps(hp: dict, epochs: int, total_steps: int) -> int:
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
        return steps_per_epoch(save_every_epochs, epochs, total_steps)
    return max(1, total_steps) + 1


def resolve_sample_sampler(hp: dict, defaults: dict) -> str:
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


def resolve_lr_scheduler(hp: dict) -> dict:
    """Build the `train.lr_scheduler` / `train.lr_scheduler_params` pair.

    ai-toolkit builds torch schedulers by name in `toolkit/scheduler.py` and
    defaults to "constant" — which we relied on implicitly until now by never
    sending the key at all. Its factory understands constant, linear, cosine,
    cosine_with_restarts, step and constant_with_warmup; the first five of
    those are what the UI offers (`step` isn't, and would raise: StepLR has no
    `total_iters` parameter, which `BaseSDTrainProcess` injects unconditionally).

    Two branches need explicit params or they don't mean what the UI says:

    - **linear** maps to `torch.optim.lr_scheduler.LinearLR`, whose defaults
      (`start_factor=1/3`, `end_factor=1.0`) ramp the LR *up* over the run.
      sd-scripts' "linear" — and the shape our picker draws — decays 1 → 0, so
      the factors are pinned to match.
    - **constant_with_warmup** maps to diffusers'
      `get_constant_schedule_with_warmup`, which warns and substitutes 1000
      steps when the count is missing, so it is always passed.

    Warmup is the awkward one. sd-scripts routes every scheduler through
    diffusers' `get_*_schedule_with_warmup`, so warmup composes with any decay
    shape. ai-toolkit only has somewhere to put it on the
    `constant_with_warmup` branch. The UI hides the field for every other
    ai-toolkit scheduler, so nothing is silently dropped here that the user
    could still see.

    `cosine_with_restarts` is deliberately not offered for this backend either:
    `BaseSDTrainProcess` overwrites `T_0` with the full step count, so its
    first cycle would span the whole run and no restart would ever fire.
    """
    scheduler = str(hp.get("scheduler", "constant") or "constant")
    params: dict = {}
    if scheduler == "constant_with_warmup":
        params["num_warmup_steps"] = int(hp.get("warmup_steps", 0) or 0)
    elif scheduler == "linear":
        params["start_factor"] = 1.0
        params["end_factor"] = 0.0
    return {"lr_scheduler": scheduler, "lr_scheduler_params": params}


def split_csv(raw) -> list[str]:
    """Split a comma-separated UI string into a trimmed, non-empty list.

    Used for expert-tier `layer_targeting` → network_kwargs.only_if_contains.
    """
    if not raw:
        return []
    return [part.strip() for part in str(raw).split(",") if part.strip()]


def first_resolution(hp: dict, defaults: dict) -> int:
    """Get the first (largest) resolution value for sample generation."""
    res = hp.get("resolution", defaults.get("resolution", [1024]))
    if isinstance(res, list):
        return max(res) if res else 1024
    return int(res)
