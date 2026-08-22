"""Musubi Tuner training provider.

kohya-ss/musubi-tuner — same author and lineage as sd-scripts, so the whole
log grammar, spawn, training-loop state machine and cancellation come from
`SdScriptsProvider` unchanged (its save/sample log lines were verified against
the checkout to match the base patterns verbatim). What differs, and lives
here:

- **Mandatory two-phase pre-cache.** Latents and text-encoder outputs are
  cached by dedicated scripts before training; the training run reads only the
  caches. Both scripts skip up-to-date items, so re-runs cost seconds.
- **Split model files** — `--dit` / `--vae` / `--text_encoder` instead of one
  checkpoint.
- **Dataset TOML shape** — flat `[[datasets]]` blocks with `image_directory`
  and a per-dataset `cache_directory`; no `[[datasets.subsets]]`, and no
  caption-augmentation keys (shuffle/keep-tokens/dropout are sd-scripts-only —
  musubi's strict TOML schema rejects unknown keys, so they are dropped here).
- **Flow-matching args** (`--timestep_sampling` / `--weighting_scheme none` /
  `--discrete_flow_shift`) replace the DDPM noise controls, and
  `--save_precision` defaults to fp32 upstream so it is always passed.

Supported architectures: Z-Image Base (musubi's docs recommend Base over
Turbo for training; the ai-toolkit `zimage-turbo` flow is separate), Krea 2
RAW, Qwen-Image, and Flux.2 Klein Base 4B/9B. Per-arch quirks — fp8 flag
names, `--model_version` selection, sample-prompt guidance flags — live as
keys on the SUPPORTED_MODELS entries, all verified against the checkout's
argparse setups.
"""

import hashlib
import json
import os
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Optional

from cache_cleanup import normalise, remove_tree
from config import load_config
from models import JobProgress, StartJobRequest
from providers.sd_scripts_base import (
    _SAVE_PRECISION_MAP,
    SdScriptsProvider,
    SubprocessRun,
    _find_python,
    _num,
    _parse_kv_args,
    _parse_native_resolution,
    _prompt_line_has_flag,
    _toml_bool,
    _toml_str,
)

# --- Model definitions ---
#
# Musubi-side catalogue, same shape philosophy as the Kohya one: each entry
# carries the per-architecture scripts and component→flag mapping so the CLI
# builder stays generic. Musubi architectures additionally name their two
# cache scripts, since pre-caching is per-model-family.
#
# Per-arch keys beyond the Kohya set (all verified against the checkout's
# argparse setups):
# - `te_fp8_flag`: the text-encoder fp8 flag this arch's train + TE-cache
#   scripts accept (`fp8_llm` / `fp8_vl` / `fp8_text_encoder`), or None where
#   the scripts have none (Krea 2 hardcodes its TE to bf16).
# - `extra_args` / `cache_extra_args`: static per-arch flags for the train
#   script and for *both* cache scripts (Flux.2's `--model_version`).
# - `sample_guidance_flag`: the prompt-file flag that actually controls
#   guidance for this arch. Musubi archs read CFG from `--l` — except Flux.2,
#   whose sampler reads `--g` for both embedded guidance and true CFG.
# - `sample_default_negative`: injected as `--n` when the prompt has none.
#   Krea 2 only engages CFG when a negative prompt is present, and CFG-off
#   RAW output is blurry by design.
# - `sample_flow_shift`: emit `--fs <discrete_flow_shift>` per prompt line.
#   Qwen-Image's sampler honours `--fs` but falls back to an inherited 14.5 —
#   far off its 2.2 training shift — when the line omits it.

SUPPORTED_MODELS = [
    {
        "id": "zimage",
        "name": "Z-Image Base",
        "architecture": "zimage",
        "train_script": "src/musubi_tuner/zimage_train_network.py",
        "latent_cache_script": "src/musubi_tuner/zimage_cache_latents.py",
        "te_cache_script": "src/musubi_tuner/zimage_cache_text_encoder_outputs.py",
        "network_module": "networks.lora_zimage",
        "components": [
            {
                "key": "checkpoint",
                "flag": "dit",
                "label": "Z-Image DiT",
                "required": True,
            },
            {"key": "vae", "flag": "vae", "label": "Z-Image VAE", "required": True},
            {
                "key": "qwen",
                "flag": "text_encoder",
                "label": "Qwen3 text encoder",
                "required": True,
            },
        ],
        "te_fp8_flag": "fp8_llm",
        # docs/zimage.md: "The maximum number of blocks that can be offloaded
        # is 28."
        "max_blocks_to_swap": 28,
        "train_defaults": {
            "optimizer": "adamw8bit",
            "lr": 1e-4,
            "dtype": "bf16",
            "resolution": [1024],
            "steps": 2500,
            # docs/zimage.md's recommended baseline for Z-Image training.
            "timestep_sampling": "shift",
            "discrete_flow_shift": 2.0,
        },
    },
    {
        "id": "krea2",
        "name": "Krea 2",
        "architecture": "krea2",
        "train_script": "src/musubi_tuner/krea2_train_network.py",
        "latent_cache_script": "src/musubi_tuner/krea2_cache_latents.py",
        "te_cache_script": "src/musubi_tuner/krea2_cache_text_encoder_outputs.py",
        "network_module": "networks.lora_krea2",
        "components": [
            {
                "key": "checkpoint",
                "flag": "dit",
                "label": "Krea 2 RAW DiT",
                "required": True,
            },
            {
                "key": "vae",
                "flag": "vae",
                "label": "Qwen-Image VAE",
                "required": True,
            },
            {
                # Only consulted for sample generation (TE outputs are
                # pre-cached), but our runs always sample.
                "key": "qwen",
                "flag": "text_encoder",
                "label": "Qwen3-VL text encoder",
                "required": True,
            },
        ],
        # The krea2 scripts have no TE fp8 flag at all — the training script
        # hardcodes the TE dtype to bf16.
        "te_fp8_flag": None,
        # docs/krea2.md: 28 main blocks, swap max is 28 − 2.
        "max_blocks_to_swap": 26,
        # Krea 2's sampler only runs CFG when a negative prompt exists, and
        # RAW without CFG is blurry by design — so give prompts that carry no
        # `--n` of their own a generic negative.
        "sample_default_negative": "low quality, blurry",
        "train_defaults": {
            "optimizer": "adamw8bit",
            "lr": 1e-4,
            "dtype": "bf16",
            "resolution": [1024],
            "steps": 2500,
            # docs/krea2.md: shift at 2.5 matches K2 inference at 1024x1024.
            "timestep_sampling": "shift",
            "discrete_flow_shift": 2.5,
            # Krea's reference guidance is offset by one (official 4.5).
            "guidance_scale": 5.5,
            "sample_steps": 28,
        },
    },
    {
        "id": "qwen-image",
        "name": "Qwen-Image",
        "architecture": "qwenimage",
        "train_script": "src/musubi_tuner/qwen_image_train_network.py",
        "latent_cache_script": "src/musubi_tuner/qwen_image_cache_latents.py",
        "te_cache_script": "src/musubi_tuner/qwen_image_cache_text_encoder_outputs.py",
        "network_module": "networks.lora_qwen_image",
        "components": [
            {
                "key": "checkpoint",
                "flag": "dit",
                "label": "Qwen-Image DiT",
                "required": True,
            },
            {
                "key": "vae",
                "flag": "vae",
                "label": "Qwen-Image VAE",
                "required": True,
            },
            {
                "key": "qwen",
                "flag": "text_encoder",
                "label": "Qwen2.5-VL text encoder",
                "required": True,
            },
        ],
        "te_fp8_flag": "fp8_vl",
        # 60-layer DiT; musubi's convention caps swap at layers − 2. The doc's
        # VRAM table tops out at 45 and warns system RAM climbs sharply beyond.
        "max_blocks_to_swap": 58,
        # Qwen-Image's sampler honours `--fs` but defaults to an inherited
        # 14.5 when absent — emit the training shift so samples match.
        "sample_flow_shift": True,
        "train_defaults": {
            "optimizer": "adamw8bit",
            # docs/qwen_image.md trains LoRA at 5e-5, not the usual 1e-4.
            "lr": 5e-5,
            "dtype": "bf16",
            "resolution": [1024],
            "steps": 2500,
            # docs/qwen_image.md: unusually low shift for a flow-matching arch.
            "timestep_sampling": "shift",
            "discrete_flow_shift": 2.2,
        },
    },
    {
        "id": "flux2-klein-base-4b",
        "name": "Flux.2 Klein Base 4B",
        "architecture": "flux",
        "train_script": "src/musubi_tuner/flux_2_train_network.py",
        "latent_cache_script": "src/musubi_tuner/flux_2_cache_latents.py",
        "te_cache_script": "src/musubi_tuner/flux_2_cache_text_encoder_outputs.py",
        "network_module": "networks.lora_flux_2",
        "components": [
            {
                "key": "checkpoint",
                "flag": "dit",
                "label": "Klein Base 4B DiT",
                "required": True,
            },
            # The app catalogues Flux.2's autoencoder under the `ae` component
            # type (shared with the ai-toolkit Klein download); musubi's flag
            # for it is `--vae`.
            {"key": "ae", "flag": "vae", "label": "Flux.2 VAE", "required": True},
            {
                "key": "qwen",
                "flag": "text_encoder",
                "label": "Qwen3 4B text encoder",
                "required": True,
            },
        ],
        "te_fp8_flag": "fp8_text_encoder",
        # Selects the arch variant in all three scripts (their shared parser
        # validates it; the TE loader derives 4B-vs-8B from it too).
        "extra_args": ["--model_version=klein-base-4b"],
        "cache_extra_args": ["--model_version=klein-base-4b"],
        # Flux.2 sampling reads guidance — embedded *and* true CFG — from
        # `--g`; `--l` is parsed but never consulted.
        "sample_guidance_flag": "g",
        # docs/flux_2.md: max with fp8 for klein-4b.
        "max_blocks_to_swap": 13,
        "train_defaults": {
            "optimizer": "adamw8bit",
            "lr": 1e-4,
            "dtype": "bf16",
            "resolution": [1024],
            "steps": 2500,
            # Resolution-aware schedule that derives its own mu — the doc's
            # recommendation; --discrete_flow_shift isn't consulted by it.
            "timestep_sampling": "flux2_shift",
            "discrete_flow_shift": 1.0,
        },
    },
    {
        "id": "flux2-klein-base-9b",
        "name": "Flux.2 Klein Base 9B",
        "architecture": "flux",
        "train_script": "src/musubi_tuner/flux_2_train_network.py",
        "latent_cache_script": "src/musubi_tuner/flux_2_cache_latents.py",
        "te_cache_script": "src/musubi_tuner/flux_2_cache_text_encoder_outputs.py",
        "network_module": "networks.lora_flux_2",
        "components": [
            {
                "key": "checkpoint",
                "flag": "dit",
                "label": "Klein Base 9B DiT",
                "required": True,
            },
            {"key": "ae", "flag": "vae", "label": "Flux.2 VAE", "required": True},
            {
                "key": "qwen",
                "flag": "text_encoder",
                "label": "Qwen3 8B text encoder",
                "required": True,
            },
        ],
        "te_fp8_flag": "fp8_text_encoder",
        "extra_args": ["--model_version=klein-base-9b"],
        "cache_extra_args": ["--model_version=klein-base-9b"],
        "sample_guidance_flag": "g",
        # docs/flux_2.md: max with fp8 for klein-9b.
        "max_blocks_to_swap": 16,
        "train_defaults": {
            "optimizer": "adamw8bit",
            "lr": 1e-4,
            "dtype": "bf16",
            "resolution": [1024],
            "steps": 2500,
            "timestep_sampling": "flux2_shift",
            "discrete_flow_shift": 1.0,
        },
    },
]

# Optimizers musubi-tuner can construct. AdamW/AdamW8bit/Adafactor are handled
# by its factory directly; everything else falls through to a generic loader
# that imports a dotted path, or reads a bare name off `torch.optim`. So the
# bitsandbytes classes below work unmodified (bitsandbytes is a declared
# dependency) while lion/prodigy — extra packages neither declared nor
# importable by bare name — die at optimizer construction. Checked in
# validate_request so a saved config carrying one fails before enqueue rather
# than seconds into the run.
_BARE_OPTIMIZERS = {"adamw", "adamw8bit", "adafactor"}

# Full paths handed to that generic loader. It resolves the class with getattr
# on the name *as typed*, so these strings must reach the command line with
# their casing intact — see _canonical_optimizer.
_DOTTED_OPTIMIZERS = (
    "bitsandbytes.optim.Lion8bit",
    "bitsandbytes.optim.PagedAdamW8bit",
    "bitsandbytes.optim.AdEMAMix8bit",
)

# Optimizers that accept a weight_decay kwarg, for the weight_decay emission.
# Adafactor takes one too but musubi drives it through its own relative_step
# path, so it stays out (unchanged behaviour).
_WEIGHT_DECAY_OPTIMIZERS = {"adamw", "adamw8bit", *_DOTTED_OPTIMIZERS}


def _canonical_optimizer(value: object) -> Optional[str]:
    """The exact `--optimizer_type` string for `value`, or None if unsupported.

    Musubi lowercases the name itself when matching its three special cases, so
    bare names can go down as-is; dotted paths are restored to their canonical
    casing because the fallback loader is case-sensitive.
    """
    lowered = str(value or "").strip().lower()
    if lowered in _BARE_OPTIMIZERS:
        return lowered
    for dotted in _DOTTED_OPTIMIZERS:
        if dotted.lower() == lowered:
            return dotted
    return None


def _find_model(model_id: str) -> Optional[dict]:
    for m in SUPPORTED_MODELS:
        if m["id"] == model_id:
            return m
    return None


class MusubiProvider(SdScriptsProvider):
    """Training provider backed by kohya-ss/musubi-tuner.

    Note on guidance flags: musubi prompt files carry CFG scale as `--l`,
    same as sd-scripts — its samplers parse `--g` too but ignore it for every
    arch except Flux.2 (which reads guidance *only* from `--g`, hence that
    model entry's `sample_guidance_flag` override). This provider previously
    emitted `--g` across the board; Z-Image samples silently fell back to the
    parser's CFG default of 4.0, which happened to match the app's default.
    """

    # musubi filters its image list down to images that have a caption file
    # (`dataset/media_utils.py:glob_images`), so an image we couldn't compose a
    # caption for doesn't train blank — it isn't trained at all.
    no_caption_outcome = "will be left out of the dataset"

    def __init__(self, scripts_path: str):
        super().__init__(scripts_path)
        # Latent/TE caches are keyed by dataset+settings, not by job, so they
        # live outside the per-job config dirs and survive across runs.
        # Resolved lazily so constructing a provider doesn't touch the
        # filesystem (load_config creates the training dirs as a side effect).
        self._cache_root: Optional[Path] = None
        # `{job_id: [(dataset folder, cache dir)]}` for runs that opted into
        # post-run cache clearing. The fingerprint a cache dir is named for
        # can't be recomputed reliably after the fact (it folds in the caption
        # emission, which is decided per run against the files on disk), so
        # `generate_config` records what it resolved and `finish_run` — the only
        # thing that removes an entry — reads it back. Keyed by job id because
        # the provider is a singleton and runs overlap.
        self._run_cache_dirs: dict[str, list[tuple[str, Path]]] = {}

    @property
    def cache_root(self) -> Path:
        if self._cache_root is None:
            self._cache_root = load_config().training_dir / "musubi-cache"
        return self._cache_root

    # --- Environment / request validation ---

    async def validate_environment(self) -> tuple[bool, Optional[str]]:
        if not self._scripts_path.exists():
            return (
                False,
                f"musubi-tuner path does not exist: {self._scripts_path}",
            )

        for model in SUPPORTED_MODELS:
            for key in ("train_script", "latent_cache_script", "te_cache_script"):
                script = self._scripts_path / model[key]
                if not script.exists():
                    return (
                        False,
                        f"musubi-tuner checkout at {self._scripts_path} is "
                        f"missing {model[key]} — needed to train "
                        f"{model['name']}. Update to a checkout that includes "
                        "it.",
                    )

        return True, None

    def validate_request(self, request: StartJobRequest) -> list[str]:
        """Cheap semantic checks; unknown-model is validation.py's job."""
        errors: list[str] = []
        hp = request.hyperparameters

        native = hp.get("native_resolution")
        if native:
            try:
                _parse_native_resolution(native)
            except ValueError as e:
                errors.append(str(e))

        optimizer = hp.get("optimizer", "adamw8bit")
        if _canonical_optimizer(optimizer) is None:
            errors.append(
                f"Musubi Tuner cannot run the '{optimizer}' optimizer — "
                "supported: "
                + ", ".join(sorted(_BARE_OPTIMIZERS) + list(_DOTTED_OPTIMIZERS))
            )

        model_def = _find_model(request.base_model)
        if model_def is None:
            return errors

        blocks_to_swap = int(hp.get("blocks_to_swap", 0) or 0)
        max_swap = model_def.get("max_blocks_to_swap", 0)
        if blocks_to_swap > max_swap:
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

    # --- Dataset config ---

    async def generate_config(
        self, request: StartJobRequest, config_dir: str, job_id: str
    ) -> str:
        """Write the musubi dataset TOML and return its path.

        Musubi's TOML parser (voluptuous, strict) accepts only its own keys:
        `[general]` + flat `[[datasets]]` with image_directory /
        cache_directory / num_repeats / batch_size / resolution / bucket
        flags. The sd-scripts caption-augmentation keys do not exist here, so
        any the client set are dropped (with a console note) rather than
        written as unknown keys the parser would reject.
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

        # Exact WxH pins the size outright: bucketing off, no resize. Same
        # contract as the Kohya provider (see _parse_native_resolution).
        native = _parse_native_resolution(hp.get("native_resolution"))
        enable_bucket = not native
        # What actually lands in the TOML's `resolution` key below — `[W, H]`
        # for a native run, `[max_res]` otherwise (the rest of a multi-value
        # `resolution` list is discarded; only the max is ever written). This
        # is also what the cache dir gets fingerprinted on — see `_cache_dir`
        # for why that has to be the effective value, not the requested list.
        effective_resolution = list(native) if native else [max_res]

        dropped = [
            ds.path
            for ds in request.datasets
            if ds.caption_shuffling
            or int(ds.keep_tokens)
            or float(ds.caption_dropout_rate or 0) > 0
            or ds.flip_augment
            or ds.is_regularization
        ]
        if dropped:
            print(
                "[musubi] Ignoring caption shuffle/keep-tokens/dropout/flip/"
                "regularisation settings — musubi-tuner's dataset config has "
                f"no such keys. Affected: {', '.join(dropped)}"
            )

        lines: list[str] = []
        lines.append("[general]")
        lines.append('caption_extension = ".txt"')
        if native:
            lines.append(f"resolution = [{native[0]}, {native[1]}]")
        else:
            lines.append(f"resolution = {max_res}")
        lines.append(f"batch_size = {int(hp.get('batch_size', 1))}")
        lines.append(f"enable_bucket = {_toml_bool(enable_bucket)}")
        if enable_bucket:
            bucket_no_upscale = bool(hp.get("bucket_no_upscale", False))
            lines.append(f"bucket_no_upscale = {_toml_bool(bucket_no_upscale)}")
        lines.append("")

        # A re-run under the same output name must not silently overwrite the
        # previous run's checkpoints or --save_state dirs (see
        # `_supersede_previous_run`), before anything below starts writing.
        self._supersede_previous_run(request, job_id)

        # Compose hybrid captions into run-scoped files beside the images, and
        # point the datasets that got them at the extension they were written
        # under. `caption_extension` is one of the keys musubi accepts in either
        # [general] or [[datasets]] (docs/dataset_config.md), so the per-dataset
        # override is valid; folders with no hybrid captions are absent from the
        # mapping and inherit the `.txt` set under [general].
        caption_extensions = self._compose_captions(request, job_id)

        model_paths = self._component_paths(request, model_def)
        clear_caches = bool(hp.get("clear_caches"))
        used_cache_dirs: list[tuple[str, Path]] = []
        for index, ds in enumerate(request.datasets):
            extension = caption_extensions.get(index)
            cache_dir = self._cache_dir(
                request,
                model_def,
                ds.path,
                effective_resolution,
                enable_bucket,
                model_paths,
                # Only folders we actually composed have captions that depend
                # on the emission. Feeding it in unconditionally would give
                # every existing non-hybrid dataset a new fingerprint and throw
                # away a cache that is still perfectly valid.
                ds.caption_emission if extension else None,
            )
            if clear_caches:
                used_cache_dirs.append((ds.path, cache_dir))
            lines.append("[[datasets]]")
            lines.append(f"image_directory = {_toml_str(ds.path)}")
            lines.append(f"cache_directory = {_toml_str(str(cache_dir))}")
            lines.append(f"num_repeats = {int(ds.num_repeats)}")
            if extension:
                lines.append(f"caption_extension = {_toml_str(extension)}")
            lines.append("")

        config_path = os.path.join(config_dir, f"{request.output_name}.toml")
        with open(config_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))

        if used_cache_dirs:
            self._run_cache_dirs[job_id] = used_cache_dirs

        return config_path

    def _cache_dir(
        self,
        request: StartJobRequest,
        model_def: dict,
        dataset_path: str,
        effective_resolution: list[int],
        enable_bucket: bool,
        model_paths: dict,
        caption_emission: Optional[str] = None,
    ) -> Path:
        """Resolve (and create) the shared cache dir for one dataset folder.

        Fingerprinted on everything that changes what the cache scripts would
        write — dataset path, the resolution actually written into the
        dataset TOML, bucketing, the VAE and TE files, the architecture — so a
        settings change gets a fresh dir while image-content changes are left
        to the scripts' own up-to-date checks. Stale dirs are inert (a cleanup
        sweep can come later; it matters more now that dedup actually works,
        but is still out of scope here).

        `effective_resolution` must be exactly what `generate_config` writes
        into the TOML's `resolution` key for this run — `[W, H]` for a native
        WxH run, `[max(resolution)]` otherwise. Fingerprinting on the
        *requested* resolution list instead (as this used to) gave a
        multi-value run like `[512, 768, 1024]` a different cache dir from an
        equivalent `[1024]` run, even though `generate_config` only ever
        writes the single largest value into the TOML for a non-native run —
        the two configs produce byte-identical latent and text-encoder
        caches, so the mismatch was pure duplication (multi-GB per dataset
        folder for a bucketed dataset).

        The emission is in there because the text-encoder cache is computed
        from the captions: two runs over the same folder wanting different
        halves of a hybrid caption would otherwise share one cache directory
        and overwrite each other's embeddings.
        """
        hp = request.hyperparameters
        fingerprint_src = json.dumps(
            {
                "dataset": str(dataset_path),
                "resolution": list(effective_resolution),
                "bucket": enable_bucket,
                "bucket_no_upscale": bool(hp.get("bucket_no_upscale", False)),
                # Flux.2 carries its autoencoder under `ae` (see _pre_train).
                "vae": model_paths.get("vae") or model_paths.get("ae"),
                "text_encoder": model_paths.get("qwen"),
                "arch": model_def["architecture"],
                "caption_emission": caption_emission,
            },
            sort_keys=True,
        )
        fingerprint = hashlib.sha1(fingerprint_src.encode("utf-8")).hexdigest()[
            :16
        ]
        cache_dir = self.cache_root / model_def["architecture"] / fingerprint
        cache_dir.mkdir(parents=True, exist_ok=True)
        # Human-readable record of what the opaque fingerprint stands for.
        manifest = cache_dir / "cache-manifest.json"
        if not manifest.exists():
            manifest.write_text(fingerprint_src, encoding="utf-8")
        return cache_dir

    # --- Components ---

    def _component_paths(
        self, request: StartJobRequest, model_def: dict
    ) -> dict[str, str]:
        """Resolve each declared component to a path; raise listing gaps."""
        hp = request.hyperparameters
        model_paths = hp.get("model_paths") or {}
        resolved: dict[str, str] = {}
        missing: list[str] = []
        for comp in model_def["components"]:
            path = model_paths.get(comp["key"])
            if comp["key"] == "checkpoint" and not path:
                path = hp.get("model_path")
            if path:
                resolved[comp["key"]] = path
            elif comp["required"]:
                missing.append(comp["label"])
        if missing:
            raise ValueError(
                f"{model_def['name']} training needs: " + ", ".join(missing)
            )
        return resolved

    # --- Pre-training cache phases ---

    async def _pre_train(
        self,
        job_id: str,
        request: StartJobRequest,
        config_path: str,
        gpu_id: int,
        run: SubprocessRun,
    ) -> AsyncGenerator[JobProgress, None]:
        """Latent + text-encoder-output caching, each as its own subprocess.

        Both run every launch: the scripts skip up-to-date items, so a warm
        start costs seconds. `_run_phase_subprocess` handles the tqdm →
        PREPARING ticks, cancellation, and non-zero-exit → RuntimeError (which
        the job manager turns into a FAILED job).
        """
        model_def = _find_model(request.base_model)
        if model_def is None:
            raise ValueError(f"Unknown model: {request.base_model}")

        paths = self._component_paths(request, model_def)
        hp = request.hyperparameters
        python_exe = _find_python(self._scripts_path)
        cwd = str(self._scripts_path)
        env = self._subprocess_env(gpu_id)

        # The VAE path lives under `vae` for most archs but `ae` for Flux.2
        # (whose autoencoder component is shared with the ai-toolkit path).
        vae_path = paths.get("vae") or paths.get("ae")
        cache_extra = model_def.get("cache_extra_args", [])

        latent_argv = [
            python_exe,
            "-u",
            str(self._scripts_path / model_def["latent_cache_script"]),
            f"--dataset_config={config_path}",
            f"--vae={vae_path}",
            *cache_extra,
        ]
        async for tick in self._run_phase_subprocess(
            job_id, run, latent_argv, cwd, env, "Caching latents"
        ):
            yield tick
        if run.cancelled:
            return

        te_argv = [
            python_exe,
            "-u",
            str(self._scripts_path / model_def["te_cache_script"]),
            f"--dataset_config={config_path}",
            f"--text_encoder={paths['qwen']}",
            *cache_extra,
        ]
        # TE fp8 flag naming varies per arch (--fp8_llm / --fp8_vl /
        # --fp8_text_encoder), and Krea 2 has none at all.
        te_fp8_flag = model_def.get("te_fp8_flag")
        if te_fp8_flag and hp.get("text_encoder_quantization") == "float8":
            te_argv.append(f"--{te_fp8_flag}")
        async for tick in self._run_phase_subprocess(
            job_id, run, te_argv, cwd, env, "Caching text-encoder outputs"
        ):
            yield tick

    # --- CLI translation ---

    def _build_cli_args(
        self, request: StartJobRequest, dataset_config: str, config_dir: str
    ) -> list[str]:
        """Translate the generic request into musubi-tuner CLI flags.

        Flags verified against the checkout's parser (hv_train_network +
        training/parser_common + utils/train_utils + zimage_setup_parser).
        Deliberately absent vs the Kohya builder: `--train_batch_size` (batch
        size is a dataset-TOML key), `--console_log_simple`,
        `--sample_sampler`, `--save_model_as`, `--cache_latents*`,
        `--text_encoder_lr` / TE-training wiring, and the DDPM-only
        `--min_snr_gamma` / `--noise_offset` (every musubi arch is
        flow-matching).
        """
        model_def = _find_model(request.base_model)
        assert model_def is not None  # validated in generate_config
        hp = request.hyperparameters
        defaults = model_def["train_defaults"]

        paths = self._component_paths(request, model_def)
        component_args = [
            f"--{comp['flag']}={paths[comp['key']]}"
            for comp in model_def["components"]
            if comp["key"] in paths
        ]

        # validate_request already restricted this to the names musubi's
        # environment can construct; canonicalising again keeps a dotted path's
        # casing intact for its case-sensitive fallback loader.
        optimizer = (
            _canonical_optimizer(hp.get("optimizer", "adamw8bit")) or "adamw8bit"
        )

        # Same duration rule as Kohya: epochs-mode lets the trainer derive the
        # true step total from its own bucket layout.
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
            f"--network_module={model_def['network_module']}",
            f"--network_dim={int(hp.get('network_dim', 16))}",
            f"--network_alpha={_num(hp.get('network_alpha', 16))}",
            f"--learning_rate={_num(hp.get('lr', defaults.get('lr', 1e-4)))}",
            f"--optimizer_type={optimizer}",
            f"--lr_scheduler={hp.get('scheduler', 'constant')}",
            duration_arg,
            f"--gradient_accumulation_steps={int(hp.get('gradient_accumulation_steps', 1))}",
            f"--mixed_precision={hp.get('mixed_precision', defaults.get('dtype', 'bf16'))}",
            # Musubi's own default is fp32 — always pass the app's choice
            # (default bf16) so checkpoints aren't silently double-sized.
            f"--save_precision={_SAVE_PRECISION_MAP.get(hp.get('save_format', 'bf16'), 'bf16')}",
            f"--max_grad_norm={_num(hp.get('max_grad_norm', 1.0))}",
            # sdpa is musubi's recommended attention on Windows (no extra
            # packages); the data-loader flags mirror its documented examples.
            "--sdpa",
            "--max_data_loader_n_workers=2",
            "--persistent_data_loader_workers",
        ]

        # Flow-matching controls. `--weighting_scheme none` is the documented
        # baseline for every currently-supported arch.
        args.append(
            f"--timestep_sampling={hp.get('timestep_type', defaults.get('timestep_sampling', 'shift'))}"
        )
        args.append("--weighting_scheme=none")
        args.append(
            f"--discrete_flow_shift={_num(hp.get('discrete_flow_shift', defaults.get('discrete_flow_shift', 2.0)))}"
        )

        # Runtime fp8 quantisation of the bf16 weights (the docs say to pass
        # both together — krea2 even raises on --fp8_base alone). Pre-quantised
        # fp8 checkpoint files are rejected by musubi — the downloader only
        # offers bf16 weights for its models.
        if hp.get("transformer_quantization") == "float8":
            args.append("--fp8_base")
            args.append("--fp8_scaled")
        # The train script reloads the TE briefly at startup to cache the
        # sample prompts' embeddings, so its quantisation choice applies here
        # too, not just in the cache phase. Flag name varies per arch; Krea 2
        # has none (its TE is hardcoded bf16).
        te_fp8_flag = model_def.get("te_fp8_flag")
        if te_fp8_flag and hp.get("text_encoder_quantization") == "float8":
            args.append(f"--{te_fp8_flag}")

        # Static per-arch flags (Flux.2's --model_version).
        args.extend(model_def.get("extra_args", []))

        blocks_to_swap = int(hp.get("blocks_to_swap", 0) or 0)
        if blocks_to_swap > 0:
            args.append(f"--blocks_to_swap={blocks_to_swap}")
            # Plain block swap round-trips every swapped block over pageable
            # memory each step — measured at ~30 s/it on Krea 2 (16 of 28
            # blocks, 16 GB card) with CPU memory churn to match. We only
            # ever train frozen-base LoRAs, so the H2D-only stream offloader
            # applies: a pinned CPU master copy streamed into a double-
            # buffered GPU ring, no device-to-host copies at all. It requires
            # gradient checkpointing (the ring's in-place loads advance the
            # autograd weight version; recompute re-reads them), so fall back
            # to plain-but-pinned swap in the rare checkpointing-off case.
            args.append("--use_pinned_memory_for_block_swap")
            if hp.get("gradient_checkpointing", True):
                args.append("--block_swap_h2d_only")

        # Optimizer args: our weight_decay emission merged with the user's
        # freeform pairs, theirs winning on key collision (same policy as the
        # Kohya builder).
        optimizer_args: list[str] = []
        if (
            float(hp.get("weight_decay", 0) or 0) > 0
            and optimizer in _WEIGHT_DECAY_OPTIMIZERS
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

        seed = int(hp.get("seed", -1))
        if seed >= 0:
            args.append(f"--seed={seed}")

        warmup = int(hp.get("warmup_steps", 0) or 0)
        if warmup > 0:
            args.append(f"--lr_warmup_steps={warmup}")

        if hp.get("scheduler") == "cosine_with_restarts":
            args.append(
                f"--lr_scheduler_num_cycles={int(hp.get('num_restarts', 1))}"
            )

        if float(hp.get("network_dropout", 0) or 0) > 0:
            args.append(f"--network_dropout={_num(hp['network_dropout'])}")

        if float(hp.get("scale_weight_norms", 0) or 0) > 0:
            args.append(f"--scale_weight_norms={_num(hp['scale_weight_norms'])}")

        user_network_args = _parse_kv_args(hp.get("network_args", ""))
        if user_network_args:
            args.append("--network_args")
            args.extend(user_network_args)

        if hp.get("gradient_checkpointing", True):
            args.append("--gradient_checkpointing")

        # Save cadence + rolling retention — same unit semantics as sd-scripts
        # (the step window is interval × count; the epoch window is a count).
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

        if request.sample_prompts:
            args.extend(self._sample_args(request, config_dir, model_def))

        if hp.get("resume_state"):
            args.append(f"--resume={hp['resume_state']}")
        if hp.get("save_state", False):
            args.append("--save_state")

        return args

    def _sample_args(
        self, request: StartJobRequest, config_dir: str, model_def: dict
    ) -> list[str]:
        """Write the sample-prompt file and return the sampling CLI flags.

        Musubi prompt lines carry CFG scale as `--l` like sd-scripts — except
        Flux.2, which reads guidance from `--g` (per-model override). `--f`
        (frame count) is deliberately never emitted for image architectures.
        There is no `--sample_sampler`; each arch uses its own fixed sampler.
        Per-model extras: a default negative prompt where CFG needs one to
        engage (Krea 2), and an explicit `--fs` where the sampler's fallback
        flow shift is far off the training value (Qwen-Image).
        """
        hp = request.hyperparameters
        defaults = model_def["train_defaults"]

        resolution = hp.get("resolution", defaults.get("resolution", [1024]))
        if not isinstance(resolution, list):
            resolution = [int(resolution)]
        sample_res = max(resolution) if resolution else 1024
        native = _parse_native_resolution(hp.get("native_resolution"))
        sample_w, sample_h = native if native else (sample_res, sample_res)
        sample_steps = int(hp.get("sample_steps", defaults.get("sample_steps", 20)))
        sample_guidance = _num(
            hp.get("guidance_scale", defaults.get("guidance_scale", 4))
        )
        guidance_flag = model_def.get("sample_guidance_flag")
        default_negative = model_def.get("sample_default_negative")
        flow_shift = (
            _num(
                hp.get(
                    "discrete_flow_shift",
                    defaults.get("discrete_flow_shift", 2.0),
                )
            )
            if model_def.get("sample_flow_shift")
            else None
        )

        prompt_lines = []
        for i, prompt in enumerate(request.sample_prompts):
            width, height = request.sample_size_at(i, sample_w, sample_h)
            line = self._add_missing_sample_flags(
                prompt, width, height, sample_steps, sample_guidance,
                guidance_flag,
            )
            if default_negative and not _prompt_line_has_flag(line, "n"):
                line += f" --n {default_negative}"
            if flow_shift is not None and not _prompt_line_has_flag(line, "fs"):
                line += f" --fs {flow_shift}"
            prompt_lines.append(line)

        prompt_file = os.path.join(
            config_dir, f"{request.output_name}.sample-prompts.txt"
        )
        with open(prompt_file, "w", encoding="utf-8") as f:
            f.write("\n".join(prompt_lines))

        args = [f"--sample_prompts={prompt_file}"]
        # A 0/0 cadence means the client-side predictors (job_manager.
        # predict_sample_steps / cadence.ts's deriveSampleSteps) already
        # report no upcoming samples — the form's cadence field has a hard min
        # of 1 and every model default is >= 250, so reaching here with 0/0
        # means a hand-edited/stale saved config, not the form. Emitting
        # neither flag keeps that "no samples" promise true.
        #
        # This matters more for musubi than for Kohya: sd-scripts guards a
        # literal `--sample_every_n_steps=0` itself (library/args.py disables
        # it with a warning), but musubi-tuner's `should_sample_images`
        # (training/sampling_prompts.py) does `steps % args.sample_every_n_steps`
        # with no such guard — a literal 0 would raise ZeroDivisionError on the
        # very first step and crash the run. Previously this sent a fabricated
        # 250-step cadence instead of 0, which avoided that crash but sampled
        # on a schedule the UI never predicted; omitting the flag is what's
        # both safe and honest.
        sample_every_steps = int(hp.get("sample_every_n_steps", 0) or 0)
        sample_every_epochs = int(hp.get("sample_every_n_epochs", 0) or 0)
        if sample_every_epochs > 0:
            args.append(f"--sample_every_n_epochs={sample_every_epochs}")
        elif sample_every_steps > 0:
            args.append(f"--sample_every_n_steps={sample_every_steps}")
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

    def finish_run(
        self,
        request: StartJobRequest,
        job_id: str,
        clear_caches: bool,
        busy_folders: set[str],
    ) -> int:
        """Drop the shared cache dirs this run used, and forget the record.

        Unlike the other two backends nothing is written into the dataset here
        — musubi's caches live under `<training>/musubi-cache/` — but they are
        the same multi-GB-per-folder artefacts, and a fingerprint dir is only
        reused by a run whose settings match exactly, so a one-off run's
        directory is dead weight the moment it ends. Only the directories this
        run resolved are removed; the rest of the cache root belongs to other
        settings and other runs.
        """
        recorded = self._run_cache_dirs.pop(job_id, [])
        if not clear_caches:
            return 0
        removed = 0
        for dataset_path, cache_dir in recorded:
            if normalise(dataset_path) in busy_folders:
                continue
            removed += remove_tree(cache_dir)
        return removed
