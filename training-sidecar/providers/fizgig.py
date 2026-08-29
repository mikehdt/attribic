"""Fizgig training provider (experimental — Krea 2 only).

shootthesound/Fizgig is not sd-scripts lineage, but it deliberately mimics the
sd-scripts contract everywhere this provider touches it — verified against the
checkout: dataset TOML with `[general]` + flat `[[datasets]]` blocks
(musubi-shaped: image_directory / cache_directory / caption_extension), a
`cache latents -> cache text -> train` pipeline whose scripts skip up-to-date
items, a `steps`-desc tqdm bar with `avr_loss=` in the postfix, `epoch N/M`
lines between epochs, `{output_name}-{epoch:06d}.safetensors` checkpoints,
`{output_name}-NNNNNN-state` resume dirs, and epoch-cadence sample files named
`{output_name}_e{epoch:06d}_{idx:02d}_{ts}_{seed}.png` under
`<output_dir>/sample/` — which is exactly `SAMPLE_NAME_RE`'s grammar. So the
whole `SdScriptsProvider` state machine applies unchanged.

What genuinely differs, and lives here:

- **Plain-python launch.** Fizgig's scripts don't use accelerate (and its venv
  doesn't ship it) — `_spawn_accelerate` is overridden to exec the script
  directly.
- **Epoch-only pacing.** `krea2_train.py` has `--max_train_epochs` but no
  step-based duration, save or sample cadence. Steps-mode requests are
  rejected up front in `validate_request` rather than silently converted.
- **Quantised-base training** is the point of the experiment: fp8 is Fizgig's
  default; `--quant_int8 bf16` (int8 forward, exact bf16 gradients) and
  `--quantize_4bit` (NF4) are the extra `transformer_quantization` values the
  form offers on this provider only. torch.compile of the transformer blocks
  is left on Fizgig's `auto` policy (it compiles when the run is long enough
  to repay the warm-up, and never under block swap).
- **Turbo-LoRA previews.** Samples render on the resident training DiT with
  the official Krea 2 Turbo LoRA applied at render time (few-step, CFG-free)
  — the optional `turbo_lora` component. Sample width/height are global flags
  rather than per-prompt, so the first prompt's size wins. sampleSteps is
  forwarded (the form defaults it to 9 on this provider); guidanceScale is
  deliberately not — it describes RAW-model CFG, and the Turbo path is
  CFG-free unless given a negative prompt, which we never send.

Log-grammar deltas: Fizgig saves epoch checkpoints silently (no "saving
checkpoint" line — intermediate saves just don't get an activity label) and
ends with "saved final LoRA -> <path>", added to the save-done patterns. Its
preview announce ("rendering previews (epoch N)") doesn't match the sampling
detector; its sampler bar (desc "sampling", total = denoise steps) fails the
training-bar checks, so the pause shows no label but nothing misparses, and
samples are claimed by the directory scan on the next bar tick.
"""

import hashlib
import json
import os
import re
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Optional

import asyncio

from cache_cleanup import normalise, remove_tree
from config import load_config
from models import JobProgress, StartJobRequest
from providers.sd_scripts_base import (
    SAVE_DONE_PATTERNS,
    SdScriptsProvider,
    SubprocessRun,
    _find_python,
    _num,
    _parse_native_resolution,
    _toml_bool,
    _toml_str,
)

SUPPORTED_MODELS = [
    {
        "id": "krea2",
        "name": "Krea 2",
        "architecture": "krea2",
        "train_script": "src/fizgig/scripts/krea2_train.py",
        "latent_cache_script": "src/fizgig/scripts/krea2_cache_latents.py",
        "te_cache_script": "src/fizgig/scripts/krea2_cache_text.py",
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
                "key": "qwen",
                "flag": "text_encoder",
                "label": "Qwen3-VL text encoder",
                "required": True,
            },
            {
                # Previews only — training runs fine without it, but with
                # sampling enabled its absence is a validate_request error
                # rather than a run that silently renders nothing.
                "key": "turbo_lora",
                "flag": "turbo_lora",
                "label": "Krea 2 Turbo LoRA (previews)",
                "required": False,
            },
        ],
        # Krea 2 has 28 transformer blocks; cap swap at 26 like the musubi
        # entry. Fizgig's Auto planner usually wants quantisation *instead* of
        # swap (torch.compile refuses under swap), so 0 is the interesting
        # default on 16 GB.
        "max_blocks_to_swap": 26,
        "train_defaults": {
            "optimizer": "adamw8bit",
            "lr": 1e-4,
            "resolution": [1024],
            # Fizgig's fixed krea2_shift recipe reads this as `shift`.
            "discrete_flow_shift": 2.5,
        },
    },
]

# App optimizer values -> Fizgig catalogue names (fizgig/training/optimizers).
# The dotted bitsandbytes spellings are what the form sends for the musubi
# provider; Fizgig catalogues the same classes under bare names. Adafactor was
# deliberately removed from Fizgig's catalogue (it fights the LR machinery),
# so it is absent here and rejected in validate_request.
_OPTIMIZER_MAP = {
    "adamw": "adamw",
    "adamw8bit": "adamw8bit",
    "bitsandbytes.optim.lion8bit": "lion8bit",
    "bitsandbytes.optim.pagedadamw8bit": "pagedadamw8bit",
    "bitsandbytes.optim.ademamix8bit": "ademamix8bit",
}

_SCHEDULERS = {
    "constant",
    "constant_with_warmup",
    "cosine",
    "cosine_with_restarts",
    "linear",
    "polynomial",
}


def _canonical_optimizer(value: object) -> Optional[str]:
    return _OPTIMIZER_MAP.get(str(value or "").strip().lower())


def _find_model(model_id: str) -> Optional[dict]:
    for m in SUPPORTED_MODELS:
        if m["id"] == model_id:
            return m
    return None


class FizgigProvider(SdScriptsProvider):
    """Training provider backed by shootthesound/Fizgig (Krea 2 only)."""

    # trainer.py: `logger.info(f"saved final LoRA -> {out}")` is the only
    # run-end save line — there is no "model saved." here.
    save_done_patterns = SAVE_DONE_PATTERNS + [
        re.compile(r"saved final lora", re.IGNORECASE)
    ]

    # image_dataset.py globs images and pairs them with caption files; an
    # image whose composed caption came out empty still trains, captionless.
    no_caption_outcome = "will train without a caption"

    def __init__(self, scripts_path: str):
        super().__init__(scripts_path)
        self._cache_root: Optional[Path] = None
        # Same contract as MusubiProvider._run_cache_dirs — see finish_run.
        self._run_cache_dirs: dict[str, list[tuple[str, Path]]] = {}

    @property
    def cache_root(self) -> Path:
        if self._cache_root is None:
            self._cache_root = load_config().training_dir / "fizgig-cache"
        return self._cache_root

    # --- Environment / request validation ---

    async def validate_environment(self) -> tuple[bool, Optional[str]]:
        if not self._scripts_path.exists():
            return False, f"Fizgig path does not exist: {self._scripts_path}"

        for model in SUPPORTED_MODELS:
            for key in ("train_script", "latent_cache_script", "te_cache_script"):
                script = self._scripts_path / model[key]
                if not script.exists():
                    return (
                        False,
                        f"Fizgig checkout at {self._scripts_path} is missing "
                        f"{model[key]} — needed to train {model['name']}. "
                        "Update to a checkout that includes it.",
                    )

        python_exe = Path(_find_python(self._scripts_path))
        if self._scripts_path not in python_exe.parents:
            return (
                False,
                f"Fizgig checkout at {self._scripts_path} has no venv — run "
                "its installer (install_fizgig.bat) first.",
            )

        return True, None

    def validate_request(self, request: StartJobRequest) -> list[str]:
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
                f"Fizgig cannot run the '{optimizer}' optimizer — supported: "
                + ", ".join(sorted(set(_OPTIMIZER_MAP.values())))
            )

        scheduler = str(hp.get("scheduler", "constant"))
        if scheduler not in _SCHEDULERS:
            errors.append(
                f"Fizgig has no '{scheduler}' LR scheduler — supported: "
                + ", ".join(sorted(_SCHEDULERS))
            )

        # Fizgig paces everything in epochs: krea2_train.py has no
        # --max_train_steps / --save_every_n_steps / --sample_every_n_steps.
        if str(hp.get("duration_mode", "steps")) != "epochs":
            errors.append(
                "Fizgig trains in epochs only — switch the run duration to "
                "epochs mode"
            )
        if int(hp.get("save_every_n_steps", 0) or 0) > 0:
            errors.append(
                "Fizgig saves on an epoch cadence only — switch checkpoint "
                "saving to epochs mode"
            )
        if int(hp.get("sample_every_n_steps", 0) or 0) > 0:
            errors.append(
                "Fizgig samples on an epoch cadence only — switch sampling to "
                "epochs mode"
            )

        network_type = str(hp.get("network_type", "lora") or "lora").lower()
        if network_type not in ("lora", "lokr"):
            errors.append(
                f"Fizgig trains 'lora' or 'lokr' networks (got '{network_type}')"
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

        if request.sample_prompts and not model_paths.get("turbo_lora"):
            errors.append(
                "Fizgig renders previews with the Krea 2 Turbo LoRA — set "
                "that component, or disable sampling for this run"
            )

        return errors

    # --- Dataset config ---

    async def generate_config(
        self, request: StartJobRequest, config_dir: str, job_id: str
    ) -> str:
        """Write the Fizgig dataset TOML and return its path.

        Fizgig's TOML schema (fizgig/dataset/config.py) is the musubi shape:
        `[general]` + flat `[[datasets]]` with image_directory /
        cache_directory / num_repeats / caption_extension, validated strictly
        with voluptuous — so, as with musubi, the sd-scripts caption
        augmentation keys are dropped with a note rather than written.
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

        native = _parse_native_resolution(hp.get("native_resolution"))
        enable_bucket = not native
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
                "[fizgig] Ignoring caption shuffle/keep-tokens/dropout/flip/"
                "regularisation settings — Fizgig's dataset config has no "
                f"such keys. Affected: {', '.join(dropped)}"
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

        self._supersede_previous_run(request, job_id)

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
        """Shared cache dir for one dataset folder — musubi's fingerprint
        scheme (see MusubiProvider._cache_dir for the reasoning), under its
        own `fizgig-cache` root because the cache file formats differ."""
        hp = request.hyperparameters
        fingerprint_src = json.dumps(
            {
                "dataset": str(dataset_path),
                "resolution": list(effective_resolution),
                "bucket": enable_bucket,
                "bucket_no_upscale": bool(hp.get("bucket_no_upscale", False)),
                "vae": model_paths.get("vae"),
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
        manifest = cache_dir / "cache-manifest.json"
        if not manifest.exists():
            manifest.write_text(fingerprint_src, encoding="utf-8")
        return cache_dir

    # --- Components ---

    def _component_paths(
        self, request: StartJobRequest, model_def: dict
    ) -> dict[str, str]:
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
        """Latent + text-encoder caching, each as its own subprocess.

        `--skip_existing` is resolution-aware in Fizgig (the cache filename
        encodes the source size and the content records the bucket, so a
        Target-resolution change re-encodes) — a warm re-run costs seconds.
        Stale-cache sweeping is the scripts' default (no `--keep_cache`).
        """
        model_def = _find_model(request.base_model)
        if model_def is None:
            raise ValueError(f"Unknown model: {request.base_model}")

        paths = self._component_paths(request, model_def)
        python_exe = _find_python(self._scripts_path)
        cwd = str(self._scripts_path)
        env = self._subprocess_env(gpu_id)

        latent_argv = [
            python_exe,
            "-u",
            str(self._scripts_path / model_def["latent_cache_script"]),
            f"--dataset_config={config_path}",
            f"--vae={paths['vae']}",
            "--skip_existing",
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
            "--skip_existing",
        ]
        async for tick in self._run_phase_subprocess(
            job_id, run, te_argv, cwd, env, "Caching text-encoder outputs"
        ):
            yield tick

    # --- CLI translation ---

    def _build_cli_args(
        self, request: StartJobRequest, dataset_config: str, config_dir: str
    ) -> list[str]:
        """Translate the generic request into krea2_train.py flags.

        All flags verified against the checkout's setup_parser. Deliberately
        absent vs the musubi builder: `--mixed_precision`/`--save_precision`
        (bf16 is hardcoded), `--network_module` (implied), step-based
        duration/cadence (epoch-only — enforced in validate_request),
        `--network_dropout`/`--scale_weight_norms`/`--network_args` (no such
        flags), and `--sdpa`/data-loader flags (Fizgig picks its own attention
        backend and loader setup).
        """
        model_def = _find_model(request.base_model)
        assert model_def is not None  # validated in generate_config
        hp = request.hyperparameters
        defaults = model_def["train_defaults"]

        paths = self._component_paths(request, model_def)

        optimizer = (
            _canonical_optimizer(hp.get("optimizer", "adamw8bit")) or "adamw8bit"
        )

        args: list[str] = [
            f"--dit={paths['checkpoint']}",
            f"--vae={paths['vae']}",
            f"--text_encoder={paths['qwen']}",
            f"--dataset_config={dataset_config}",
            f"--output_dir={request.output_path}",
            f"--output_name={request.output_name}",
            f"--network_dim={int(hp.get('network_dim', 32))}",
            f"--network_alpha={_num(hp.get('network_alpha', 32))}",
            f"--learning_rate={_num(hp.get('lr', defaults.get('lr', 1e-4)))}",
            f"--optimizer_type={optimizer}",
            f"--max_train_epochs={int(hp.get('epochs', 10))}",
            f"--gradient_accumulation_steps={int(hp.get('gradient_accumulation_steps', 1))}",
            f"--max_grad_norm={_num(hp.get('max_grad_norm', 1.0))}",
            f"--discrete_flow_shift={_num(hp.get('discrete_flow_shift', defaults.get('discrete_flow_shift', 2.5)))}",
        ]

        network_type = str(hp.get("network_type", "lora") or "lora").lower()
        if network_type == "lokr":
            args.append("--network_type=lokr")
            args.append(f"--lokr_factor={int(hp.get('lokr_factor', 8))}")

        # transformer_quantization: 'float8' is Fizgig's default (dynamic fp8
        # base), so it emits nothing; 'none' opts back into bf16; 'int8' is
        # the W8A8 frozen-base path with exact bf16 gradients; 'nf4' is the
        # QLoRA-style 4-bit base. These are mutually exclusive by construction
        # in the trainer (int8/nf4 take precedence over fp8 when set).
        quant = str(hp.get("transformer_quantization", "float8") or "float8")
        if quant == "none":
            args.append("--no_fp8")
        elif quant == "int8":
            args.append("--quant_int8=bf16")
        elif quant == "nf4":
            args.append("--quantize_4bit")

        blocks_to_swap = int(hp.get("blocks_to_swap", 0) or 0)
        if blocks_to_swap > 0:
            args.append(f"--blocks_to_swap={blocks_to_swap}")

        scheduler = str(hp.get("scheduler", "constant"))
        args.append(f"--lr_scheduler={scheduler}")
        # Fizgig's factory accepts warmup with any schedule, but a warmup on
        # `constant` is the sd-scripts crash case the form's gating was built
        # around — keep the same rule so saved configs behave identically.
        warmup = int(hp.get("warmup_steps", 0) or 0)
        if warmup > 0 and scheduler != "constant":
            args.append(f"--lr_warmup_steps={warmup}")
        if scheduler == "cosine_with_restarts":
            args.append(
                f"--lr_scheduler_num_cycles={int(hp.get('num_restarts', 1))}"
            )

        # Weight decay / user extras ride --optimizer_args as "key=value"
        # tokens (fizgig/training/optimizers.parse_optimizer_args — same
        # grammar as sd-scripts, space-separated).
        optimizer_args: list[str] = []
        if float(hp.get("weight_decay", 0) or 0) > 0:
            optimizer_args.append(f"weight_decay={_num(hp['weight_decay'])}")
        user_raw = str(hp.get("optimizer_args", "") or "").strip()
        if user_raw:
            user_tokens = user_raw.split()
            user_keys = {t.split("=", 1)[0] for t in user_tokens}
            optimizer_args = [
                t for t in optimizer_args if t.split("=", 1)[0] not in user_keys
            ]
            optimizer_args.extend(user_tokens)
        if optimizer_args:
            # One flag, one value: krea2_train takes the pairs as a single
            # space-separated string, not argparse nargs.
            args.append("--optimizer_args=" + " ".join(optimizer_args))

        seed = int(hp.get("seed", -1))
        if seed >= 0:
            args.append(f"--seed={seed}")

        save_every_epochs = int(hp.get("save_every_n_epochs", 0) or 0)
        if save_every_epochs > 0:
            args.append(f"--save_every_n_epochs={save_every_epochs}")
        if hp.get("save_state", False):
            args.append("--save_state")
            args.append("--save_state_on_train_end")
            max_keep = int(hp.get("max_saves_to_keep", 0) or 0)
            if max_keep > 0:
                args.append(f"--keep_last_n_states={max_keep}")
        if hp.get("resume_state"):
            args.append(f"--resume={hp['resume_state']}")

        if request.sample_prompts:
            args.extend(self._sample_args(request, config_dir, paths))

        return args

    def _sample_args(
        self, request: StartJobRequest, config_dir: str, paths: dict
    ) -> list[str]:
        """Prompt file + preview flags for the Turbo-LoRA sampling path.

        Fizgig prompt files are one plain prompt per line — no sd-scripts
        `--w/--h/--s` inline flags. Size is global, so the first prompt's
        resolved size applies to every preview. Step count is forwarded (the
        form defaults it to 9 on this provider, matching the Turbo LoRA's
        distillation); CFG stays on Fizgig's default (off) — its
        --sample_cfg_scale only means anything paired with a negative prompt,
        and the form's guidanceScale describes RAW-model CFG, so that field
        is hidden on this provider rather than sent.
        """
        hp = request.hyperparameters

        prompt_file = os.path.join(
            config_dir, f"{request.output_name}.sample-prompts.txt"
        )
        with open(prompt_file, "w", encoding="utf-8") as f:
            f.write("\n".join(request.sample_prompts))

        width, height = request.sample_size_at(0, 1024, 1024)
        args = [
            f"--sample_prompts={prompt_file}",
            f"--turbo_lora={paths['turbo_lora']}",
            f"--sample_width={width}",
            f"--sample_height={height}",
        ]
        sample_steps = int(hp.get("sample_steps", 0) or 0)
        if sample_steps > 0:
            args.append(f"--sample_steps={sample_steps}")
        sample_every_epochs = int(hp.get("sample_every_n_epochs", 0) or 0)
        if sample_every_epochs > 0:
            args.append(f"--sample_every_n_epochs={sample_every_epochs}")
        if hp.get("sample_first_step"):
            args.append("--sample_at_first")
        seed = int(hp.get("seed", -1))
        if seed >= 0:
            args.append(f"--sample_seed={seed}")
        return args

    def _train_command(
        self, request: StartJobRequest, config_path: str
    ) -> tuple[str, str, list[str], str]:
        model_def = _find_model(request.base_model)
        if model_def is None:
            raise ValueError(f"Unknown model: {request.base_model}")

        python_exe = _find_python(self._scripts_path)
        script = str(self._scripts_path / model_def["train_script"])
        config_dir = os.path.dirname(config_path)
        cli_args = self._build_cli_args(request, config_path, config_dir)
        return python_exe, script, cli_args, str(self._scripts_path)

    async def _spawn_accelerate(
        self,
        python_exe: str,
        script: str,
        cli_args: list[str],
        cwd: str,
        mixed_precision: str,
        gpu_id: int,
    ) -> asyncio.subprocess.Process:
        """Fizgig scripts are plain python — no accelerate in its venv, and
        the trainer manages device placement itself (bf16 throughout, so
        `mixed_precision` has nothing to configure)."""
        return await asyncio.create_subprocess_exec(
            python_exe,
            "-u",
            script,
            *cli_args,
            cwd=cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=self._subprocess_env(gpu_id),
        )

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
        recorded = self._run_cache_dirs.pop(job_id, [])
        if not clear_caches:
            return 0
        removed = 0
        for dataset_path, cache_dir in recorded:
            if normalise(dataset_path) in busy_folders:
                continue
            removed += remove_tree(cache_dir)
        return removed
