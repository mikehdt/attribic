# Musubi Tuner backend — integration plan

Status: **designed, not implemented** (Mike, 2026-08-03). Implementation is paused until
musubi-tuner is installed alongside the other backends. Everything below is written against
the post-refactor training stack (branch `training-review-2026-08`): the `SdScriptsProvider`
base class, the provider capability model, and pre-flight validation all exist specifically
so this backend is a thin addition rather than a third copy of the Kohya provider.

First target: **Z-Image Base** (musubi's docs recommend Base over Turbo for training; our
existing `zimage-turbo` ai-toolkit flow stays as-is). Image models only — video is its own
milestone (see the end).

## 1. What musubi-tuner is, for our purposes

[kohya-ss/musubi-tuner](https://github.com/kohya-ss/musubi-tuner) — same author and lineage
as sd-scripts, so the log grammar our `SdScriptsProvider` parses works nearly verbatim:
tqdm `steps:` bar on stderr with `avr_loss=`, `epoch N/M` lines, `accelerate launch`,
`{output_name}-{epoch:06d}.safetensors` checkpoints, `*-state` dirs with `--resume`,
`--network_dim/alpha/args`, `--optimizer_type/args`, `--save_every_n_steps/epochs`,
`--sample_prompts` file. Differences that drive the design:

1. **Mandatory two-phase pre-cache.** Training reads only caches; the VAE and text encoder
   are never loaded during the training run. Two CLI phases run first, per model family:
   latent caching, then text-encoder-output caching. Both skip up-to-date items, so re-runs
   are cheap.
2. **Split model-file flags** — `--dit`, `--vae`, `--text_encoder` (family-specific names:
   `--text_encoder1/2` for Kontext/HunyuanVideo, `--t5` for Wan) instead of one checkpoint.
3. **Dataset config is TOML-only** — `[general]` + `[[datasets]]` blocks; no
   `--train_data_dir`, no `5_subject` folder-name repeats convention; `num_repeats` is a
   TOML key. No `[[datasets.subsets]]` (that's sd-scripts' shape).
4. **Flow-matching args** — `--timestep_sampling shift`, `--weighting_scheme none`,
   `--discrete_flow_shift N` replace the noise-scheduler args.
5. **Memory flags** — `--fp8_base --fp8_scaled` (runtime quantisation of bf16 weights;
   pre-quantised fp8 repacks are rejected — the downloader must fetch bf16), 
   `--blocks_to_swap N` (Z-Image max 28), `--sdpa` attention.
6. **`--save_precision` defaults to fp32** (unlike sd-scripts) — always pass `bf16`/`fp16`.
7. **Sample prompt flags** — guidance is `--g` (not Kohya's `--l`); `--f` is frame count
   (omit for image models); `--d` per-prompt seed.
8. **Own venv** — python >=3.10 <3.13, torch >=2.5.1, tightly pinned deps
   (`accelerate==1.6.0`, `diffusers==0.32.1`, …) that conflict with both existing backends.
9. **Z-Image LoRAs need `convert_lora.py`** post-training for some ComfyUI loaders.

## 2. Install prerequisites (user-side, like AITK / sd-scripts)

```
git clone https://github.com/kohya-ss/musubi-tuner F:\MusubiTuner   # any location
cd F:\MusubiTuner
python -m venv venv          # python 3.10-3.12
venv\Scripts\activate
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124
pip install -e .
pip install tensorboard      # optional, for --logging_dir
```

Then in the app's `config.json`:

```json
"trainingBackends": { ..., "musubi": "F:\\MusubiTuner" }
```

`config.py` reads `trainingBackends` generically — no sidecar config change needed. The
shared `_find_python` in `sd_scripts_base.py` resolves `venv`/`.venv` inside the checkout,
same contract as the Kohya backend. No SageAttention needed (`--sdpa` is the default
recommendation and works out of the box on Windows).

## 3. Sidecar — `providers/musubi.py`

`MusubiProvider(SdScriptsProvider)`. The base class (extracted 2026-08) already provides the
stream reader, tqdm/loss/epoch parsing, sampling-pause state machine, sample claiming,
per-job cancel, accelerate spawn, and the `_run_phase_subprocess` helper built for exactly
this backend's cache phases. What the subclass declares:

```python
class MusubiProvider(SdScriptsProvider):
    time_marker_policy = "per-state-dir"   # same *-state layout as sd-scripts
    sample_guidance_flag = "g"             # musubi prompt files use --g

    # save messages: verify against the checkout at impl time; trainer_base.py
    # is sd-scripts lineage so the defaults likely already match. Override
    # save_announce_patterns / save_done_patterns only if they differ.
```

Model catalogue entry (the `SUPPORTED_MODELS` shape, musubi flavour):

```python
MUSUBI_MODELS = [{
    "id": "zimage",
    "name": "Z-Image Base",
    "architecture": "zimage",
    "train_script": "src/musubi_tuner/zimage_train_network.py",
    "latent_cache_script": "src/musubi_tuner/zimage_cache_latents.py",
    "te_cache_script": "src/musubi_tuner/zimage_cache_text_encoder_outputs.py",
    "network_module": "networks.lora_zimage",
    "components": [
        {"key": "checkpoint", "flag": "dit", "label": "Z-Image DiT", "required": True},
        {"key": "vae", "flag": "vae", "label": "Z-Image VAE", "required": True},
        {"key": "qwen", "flag": "text_encoder", "label": "Qwen3 text encoder", "required": True},
    ],
    "max_blocks_to_swap": 28,
    "train_defaults": {
        "optimizer": "adamw8bit", "lr": 1e-4, "dtype": "bf16",
        "timestep_sampling": "shift",
        # discrete_flow_shift: confirm against docs/zimage.md at impl time
    },
}]
```

Hook implementations:

- **`validate_environment`** — checkout exists, all three scripts exist, venv python found.
- **`validate_request`** (pre-flight, from the validation package) — component paths exist,
  `blocks_to_swap <= max_blocks_to_swap`, native-resolution parse.
- **`generate_config`** — musubi-shape dataset TOML:

  ```toml
  [general]
  caption_extension = ".txt"
  resolution = [1024, 1024]        # or [W, H] from native_resolution
  enable_bucket = true
  bucket_no_upscale = false

  [[datasets]]
  image_directory = "F:\\Training\\proj\\subject"
  cache_directory = "<training>/musubi-cache/zimage/<fingerprint>"
  num_repeats = 5
  batch_size = 1
  ```

  Per-dataset augmentation keys: musubi's TOML parser is strict — verify which of
  shuffle/keep-tokens/dropout it accepts at impl time and drop unsupported keys with a log
  line rather than writing unknown keys.
- **`_pre_train`** — the two cache phases, each via `_run_phase_subprocess` (which already
  handles tqdm→PREPARING ticks, `run.cancelled`, and stderr-tail errors):
  1. `python zimage_cache_latents.py --dataset_config <toml> --vae <vae>` — phase label
     "Caching latents".
  2. `python zimage_cache_text_encoder_outputs.py --dataset_config <toml>
     --text_encoder <te> [--fp8_llm]` — phase label "Caching text-encoder outputs";
     `--fp8_llm` when the form's TE quantisation is float8.
  Both phases run every launch — the scripts skip up-to-date items, so warm runs complete in
  seconds. Cache dirs: `<training>/musubi-cache/<arch>/<fingerprint>/` per dataset folder,
  `fingerprint = sha1({dataset path, resolution/native, bucket flags, vae path, te path,
  arch})[:16]` — settings changes get a fresh dir; content changes are handled by the
  scripts' own up-to-date checks. Write a small `cache-manifest.json` per dir for
  debuggability. Stale dirs are inert; a cleanup sweep can come later.
- **`_train_command`** — `(venv_python, <checkout>/src/musubi_tuner/zimage_train_network.py,
  cli_args, <checkout>)`.

CLI translation (Z-Image; form field → flag):

| Form (snake_case hyperparameters) | musubi flag |
|---|---|
| model_paths checkpoint / vae / qwen | `--dit` / `--vae` / `--text_encoder` |
| (generated TOML) | `--dataset_config <path>` |
| duration | `--max_train_steps` / `--max_train_epochs` (same rule as Kohya) |
| lr / optimizer / optimizer_args / weight_decay | `--learning_rate` / `--optimizer_type` (shared `_OPTIMIZER_MAP`) / `--optimizer_args` |
| scheduler / warmup_steps / num_restarts | `--lr_scheduler` / `--lr_warmup_steps` / `--lr_scheduler_num_cycles` |
| network dim/alpha/dropout/args | `--network_dim/alpha/dropout/args` + `--network_module networks.lora_zimage` |
| batch_size | TOML `batch_size` (not a CLI flag) |
| gradient_accumulation_steps / gradient_checkpointing | same flags |
| mixed_precision | both on `accelerate launch` and the script (base spawn covers the launcher) |
| save_format | `--save_precision` — **default bf16** (musubi's own default is fp32) |
| max_grad_norm / scale_weight_norms / seed | same flags |
| timestep_type (default `shift`) | `--timestep_sampling` + always `--weighting_scheme none` |
| discrete_flow_shift | same flag |
| transformer_quantization float8 | `--fp8_base --fp8_scaled` |
| text_encoder_quantization float8 | `--fp8_llm` (on the TE **cache** phase) |
| blocks_to_swap (≤28) | `--blocks_to_swap` |
| (always) | `--sdpa --persistent_data_loader_workers --max_data_loader_n_workers 2 --output_dir --output_name` |
| save cadence + retention | `--save_every_n_steps/epochs` + `--save_last_n_steps/epochs` (verify `--save_last_n_*` support at impl) |
| sampling | prompt file with `--w/--h/--s/--g` per line (base `_add_missing_sample_flags` with `sample_guidance_flag="g"`; no `--f` for image archs), `--sample_prompts`, `--sample_every_n_steps/epochs` |
| save_state / resume_state | `--save_state` / `--resume` |
| min_snr_gamma / noise_offset / cache_latents | **not emitted** (flow-matching; caching is external) |

Registration: `models.py` `ProviderType.MUSUBI = "musubi"`; `main.py` `_register_providers`
gains a musubi block mirroring kohya's (`backends.get("musubi")` → `MusubiProvider(path)`).

Post-train: emit a completion log line naming the `convert_lora.py` command for ComfyUI use;
an automatic convert phase is a cheap follow-up once the flow is proven.

## 4. TypeScript surface

1. `services/training/types.ts` — `TrainingProvider` union + `'musubi'`; both label records
   (`'Musubi Tuner'` / `'Musubi'`). Exhaustive `Record`s will force the label entries.
2. `services/training/provider-capabilities.ts` — add:
   `musubi: new Set([...SD_SCRIPTS_FAMILY, 'blockSwap', 'quantization'])`
   (no `verticalFlip`, no `ddpmNoiseControls`, no `latentCacheToggle` — caching is always-on).
   `SD_SCRIPTS_FAMILY` is currently module-private; export it (or inline its members) when
   this lands.
3. `services/training/models.ts` — new `zimage` (Z-Image Base) `ModelDefinition`:
   `providers: ['musubi', 'mock']` (mock already claims the `zimage` arch), components with
   downloadIds `dl-zimage-base-dit` / `shared-zimage-vae` / `shared-zimage-qwen3`, defaults
   (~2500 steps, 1e-4, `saveFormat 'bf16'`, float8 transformer, `resolution [1024]`),
   `hiddenFields` for TE-training/DDPM/ai-toolkit-only fields, tips noting Base-over-Turbo.
   Leave `zimage-turbo` untouched. `OPTIMIZER_OPTIONS`: add `'musubi'` where its pinned deps
   support the package (verify lion/prodigy against its pyproject).
4. `services/model-manager/registries/training-models.ts` — three download entries. Sources:
   DiT/VAE/Qwen3-TE from `Tongyi-MAI/Z-Image` or `Comfy-Org/z_image`. The text encoder is
   **multi-shard**: all shards go in `files[]`, and the component path must resolve to the
   *first* shard (`...00001-of-000NN.safetensors`) — verify the resolver handles multi-file
   components. Fetch **bf16** weights only (fp8 repacks are rejected by musubi).
5. `services/training/build-sidecar-request.ts` — no new fields expected (`blocks_to_swap`,
   quantisation, `model_paths` already flow); confirm against the typed builder.
6. `services/training/caption-emission.ts` — keyed on architecture; `zimage` already
   resolves.

## 5. Verification (when implemented)

1. `GET /providers` lists musubi; `GET /providers/musubi/validate` passes with the checkout.
2. Mock run of the `zimage` model through the queue (UI wiring).
3. Real run: tiny dataset, ~50 steps, `save_every_n_steps=25`, `sample_every_n_steps=25`:
   - both cache phases render as determinate PREPARING bars; a warm re-run's phases finish
     in seconds;
   - cancel during latent caching kills the cache subprocess and terminalises the job;
   - checkpoints/samples/state dirs claimed; time marker lands beside the `-state` dir;
   - resume from a state dir carries the training clock forward.
4. `convert_lora.py` output loads in ComfyUI.
5. Existing pytest suite (`uv run --group dev pytest tests/ -q`) extended with: musubi TOML
   generation, cache fingerprinting, CLI translation table, `--g` sample flags via the
   existing `sample_guidance_flag` subclass test.

## 6. Later (not this backend's first landing)

- **Qwen-Image** (20B; fp8 + `blocks_to_swap 30-45`, RAM-hungry but proven 12 GB path) and
  **FLUX.2 klein 4B/9B** — cheap follow-ons once zimage lands: new catalogue entries +
  download manifests, same provider.
- **Video training** (Wan 2.1/2.2, HunyuanVideo): needs media-type on `SampleImage` +
  `.mp4`-aware completeness checks in `sample_archive.py`, video rendering in the samples
  route/grid/lightbox, dataset `video_directory`/`target_frames`/`frame_extraction` keys,
  3-D (frames) bucketing, the `imageCount` naming sweep, and Wan 2.2's dual-DiT downloads
  (`--dit_high_noise`, Wan2.1 VAE, no CLIP). README guidance: 24 GB VRAM for video.
- Edit/control models (FLUX.1 Kontext, Qwen-Image-Edit) need a paired-image dataset UI.
- Automatic `convert_lora.py` phase; stale musubi-cache sweep.
