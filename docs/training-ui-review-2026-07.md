# Training UI review — July 2026

Review of the LoRA training configuration UI: tier structure (Simple / Intermediate / Advanced),
field placement, and the gap between what the form collects and what the two real backends
(ai-toolkit / Ostris and Kohya sd-scripts) actually consume.

Branch: `training-ui-review-2026-07`. Sweep 1 covers findings 1–2 (bugs + provider-aware
visibility) plus the Kohya SDXL decision; findings 3–6 are a second sweep.

## Verdict

The three-tier structure itself is sound. The core problem is that the form renders the
**union** of both backends' knobs and silently drops roughly a third of them depending on the
selected backend. Secondary problems: five models fail at job start due to registry mismatches,
and the per-folder augmentation UI is never forwarded to the sidecar at all.

## Finding 1 — outright bugs

### 1a. Five of eleven models fail at job start

The Node model catalogue (`src/app/services/training/models.ts`) and the sidecar
`SUPPORTED_MODELS` lists disagree:

| Model | UI provider | Problem |
|---|---|---|
| `sdxl`, `illustrious-xl`, `noob-ai-xl` | kohya | Kohya provider (`training-sidecar/providers/kohya.py`) is Anima-only → `Unknown model` |
| `flux2` (Klein 9B) | ai-toolkit | No entry in `ai_toolkit.py` `SUPPORTED_MODELS` (local ai-toolkit install *does* have arch `flux2_klein_9b`) |
| `ltx23` | ai-toolkit | No sidecar entry (local install has arch `ltx2.3`) |

**Decision (Mike, 2026-07-10):** implement Kohya SDXL support (`sdxl_train_network.py` exists in
the local sd-scripts install), *and* offer ai-toolkit as an alternative backend for the SDXL
family since the sidecar already supports the arch. The backend choice must persist with saved
projects. Add sidecar ai-toolkit entries for `flux2` and `ltx23`.

### 1b. Per-folder augmentation is a placebo

`buildDatasets` (`src/app/services/training/build-sidecar-request.ts`) forwards only `path`,
`num_repeats`, `lora_weight`, `is_regularization`. The FolderRow's Shuffle Captions, Keep
Tokens, Caption Dropout, and Flip toggles are collected and dropped. Both providers read
`keep_tokens` / `caption_shuffling` / `caption_dropout_rate` / `flip_augment` from top-level
hyperparameters with code defaults, so the UI settings never take effect.

**Fix:** forward these per-folder and consume them per-dataset (ai-toolkit) / per-subset
(Kohya TOML), preserving the existing per-folder UI semantics. Flip-vertical has no consumer
on Kohya (sd-scripts `flip_aug` is horizontal-only); hide it where unsupported.

## Finding 2 — fields that silently do nothing per backend

Providers hardcode or ignore many visible fields:

| Field | ai-toolkit | Kohya (Anima) |
|---|---|---|
| LR Scheduler / Warmup / Restarts | ignored (not emitted) | ✅ |
| Weight Decay, Seed | ignored | ✅ |
| Output Precision (`saveFormat`) | ignored — `save.dtype` hardcoded `float16` | ✅ |
| Gradient Checkpointing, Cache Latents | ignored — hardcoded `True` | ✅ |
| Sample Steps, Guidance Scale, Noise Scheduler | ignored — model-family defaults | ignored — `euler_a` hardcoded |
| Loss Type, Timestep Bias, EMA, Backbone LR | ✅ | ignored |
| Cache Text Embeddings, Unload Text Encoder | ✅ | ignored (auto-derived) |
| LoRA Type (LoKr) | ✅ | ignored — `networks.lora_anima` hardcoded |

**Fix:** per-provider visibility in the field registry (`providers?: TrainingProvider[]` on
field meta, applied in `getVisibleFields` alongside tier and `hiddenFields`). Fields dead on
*both* backends (sample steps / guidance / noise scheduler) are hidden entirely until sweep 2
plumbs them (ai-toolkit sample config and Kohya's prompt-file flags both support them).

Related: the "Musubi Tuner" provider label exists in `types.ts` with no backend behind it.

## Finding 3 — tier placement (sweep 2)

- Cache Latents: Simple → Advanced (or remove; hardcoded on for ai-toolkit).
- Output Precision: Simple → Intermediate.
- Seed: lives in the Sampling section but is the *training* seed (Kohya `--seed`; ai-toolkit's
  sample seed is hardcoded 42). Move to Learning.
- Resolution: consider Intermediate → Simple; it genuinely changes outcomes for novices.
- **Trigger word** is the one missing Simple-tier feature (ai-toolkit supports `trigger_word`
  natively; Kohya approximated via keep-tokens/caption injection).

## Finding 4 — options worth adding (sweep 2)

Cheap (sidecar already reads them, once forwarding is fixed): keep tokens, caption shuffling,
caption dropout, flip augment as global Intermediate fields if the per-folder UI proves fiddly.

- Caption dropout visibility: ai-toolkit currently hardcodes 0.05 — real behaviour the user
  can't see or disable.
- Prodigy/DAdaptation footgun: dropdown offers them but sends `lr 1e-4`; they want `lr ≈ 1.0`.
  Auto-adjust or warn.
- Advanced: `discrete_flow_shift` (Kohya, hardcoded 1.0), `ema_decay` (ai-toolkit, hardwired
  0.99), `scale_weight_norms` / `min_snr_gamma` (Kohya), sample seed/sampler overrides,
  bucketing controls (`bucket_reso_steps` hardcoded 64, `bucket_no_upscale`).

## Finding 5 — Expert tier (sweep 2)

The registry already defines an `'expert'` tier with zero fields and no UI toggle
(`field-registry.ts`). Adding the fourth segment is trivial. Candidates: freeform
`network_args` / `optimizer_args` editors, LoKr shape params, ai-toolkit `content_or_style` /
`diff_output_preservation` / layer targeting / `low_vram`, Kohya `blocks_to_swap`.

## Finding 6 — LTX / Wan (sweep 2)

Nominally wired but practically untrainable: no `downloadId`s (model manager filters the
architecture groups out), and the dataset pipeline is image-only (no `num_frames`, no video
bucketing, no frame extraction in either provider). No model carries any untested/experimental
flag today. Plan: add `experimental: true` + UI badge; video pipeline is its own milestone.

## Also noted (job panel, non-blocking)

- After a page refresh, `hydrateActiveTraining` reconstructs a minimal config (resolution
  forced to 1024, datasets empty) so hydrated job cards show placeholder detail.
- `phase` / `currentStep` dual meanings during prep vs training can make the step counter
  look like it jumps around.

## Sweep 1 execution log

- [x] Review doc committed
- [x] 1b: per-folder augmentation forwarding (both providers) — `c92167d`
- [x] 2: provider-aware field visibility — `224ffca`
- [x] 1a: Kohya SDXL + SDXL-family dual backend + `flux2`/`ltx23` sidecar entries + provider
      fallback on project load — `56f0009` (provider choice already persisted via FormState)
- [x] Opus review pass, Fable final review — no blockers; nits fixed in follow-up commit

### Behaviour changes shipped in sweep 1

- ai-toolkit caption dropout was silently hardcoded to 0.05; it now follows the per-folder
  UI value (default 0 = disabled). Set it explicitly if the old implicit dropout mattered.
- Kohya `--cache_text_encoder_outputs` is now suppressed whenever any dataset folder uses
  caption shuffling or caption dropout (sd-scripts asserts on that combination — this was a
  latent Anima crash once shuffle became live).
- Flip-vertical is hidden per-folder when the Kohya backend is selected (sd-scripts has no
  vertical flip; ai-toolkit uses `flip_x`/`flip_y`).

## Sweep 2 execution log (branch training-ui-sweep-2)

- [x] Finding 3 tier moves — resolution→Simple, cacheLatents→Advanced, saveFormat→Intermediate,
      seed→Learning section (it's the training seed); Expert view-mode segment enabled
      (`VALID_VIEW_MODES` sanitiser needed updating); Wan/LTX experimental badges — `90cd2fc`
- [x] Finding 4 sampling — sample steps/guidance live on both backends (ai-toolkit sample
      config; Kohya per-prompt-line `--w/--h/--s/--l`); dead `noiseScheduler` field deleted
      (arch-determined) and replaced with a Sampler dropdown; training seed reached ai-toolkit
      via `training_seed`, so Seed is no longer Kohya-only — `d1783aa`
- [x] Finding 4 knobs — discrete flow shift, scale weight norms, min-SNR gamma + noise offset
      (DDPM-only; Anima's trainer overrides both hooks so they're hidden for it), bucket
      controls, EMA decay; Prodigy/DAdaptation LR guard (snap to 1.0 / restore, never touching
      hand-typed values). All six optimizer options turned out valid on both backends, so no
      per-provider dropdown filtering was needed — `77db832`
- [x] Finding 5 Expert fields — Kohya `network_args`/`optimizer_args` freeform editors (user
      pairs win on collision), `blocks_to_swap` (Anima-only in this fork); ai-toolkit LoKr
      factor, content-or-style, diff output preservation (+multiplier/class), layer targeting
      (`only_if_contains`), low VRAM — `38f2ffe`
- [x] **Trigger word: deliberately dropped** (implemented then reverted mid-branch). This app
      is itself a tag editor — a trigger belongs in the captions as a deliberate first tag
      protected by keep-tokens, visible in the data; train-time injection would hide part of
      the effective caption outside the tagger. Not forgotten; decided against (Mike,
      2026-07-10).
- [x] Finding 6 — experimental badges shipped in `90cd2fc`; video pipeline remains its own
      milestone.
- [x] Opus review + Fable final pass — no blockers. Should-fix applied: `hydrateFromProject`
      now merges saved forms over `defaultsToFormState` so projects saved before this branch
      don't hydrate `undefined` into the ~18 new fields (blank dropdowns, controlled-input
      warnings, phantom hidden-changes badges). Nits applied: Sampler hidden for Anima (its
      sample path ignores `--sample_sampler`), `network_args` dedup matches `optimizer_args`
      policy, inline warning when diff output preservation + cache text embeddings are both
      on (ai-toolkit refuses that combination at startup).

### Still open after sweep 2

- Kohya SDXL and the new knobs need a real end-to-end training run.
- Video pipeline for Wan/LTX (frame counts, video bucketing) — own milestone.
- `ltx2`'s HF fallback repo id predates `Lightricks/LTX-2` naming (cosmetic).
- Queue persistence / ONNX-bypasses-queue decision (pre-existing backlog).

### Review outcome sweep 1 (Opus pass + Fable final)

No blockers. Nits fixed post-review: `illustrious-xl`/`noob-ai-xl` now zero their
quantisation defaults like `sdxl` (the inherited `float8` was dead config on the ai-toolkit
SDXL path); `ltx23`'s cosmetic HF fallback repo id was malformed. Noted and deliberately left:
`KohyaProvider.validate()` now requires every supported model's train script to exist in the
sd-scripts checkout (fine for the combined fork in use); the `ltx2` entry's HF fallback
(`LTX-Video-0.9.7-dev`) predates the current `Lightricks/LTX-2` naming — cosmetic, since the
client always sends a local checkpoint path.
