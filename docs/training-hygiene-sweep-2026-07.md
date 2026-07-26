# Training code hygiene sweep — July 2026

A pass across the training stack (`src/app/training`, `src/app/store/training*`,
`src/app/services/training`, `src/app/shared/activity-panel`, `training-sidecar/`)
looking for duplication, drift and dead code. This records what was fixed and
what was deliberately left for later.

---

## Fixed

### Bugs

**`nativeResolution` never reached the trainer.** `buildSidecarStartRequest`
read `config.nativeResolution`, but `handleStart` built its payload as a
hand-maintained field-by-field allowlist that omitted it — so `native_resolution`
was always `undefined` and the Kohya provider never saw it. The field rendered,
validated, persisted into saved projects, showed in the summary and took part in
dirty-state; it just never trained.

Fixed at the class level rather than by adding one line: `handleStart` now
spreads the whole form and overrides only the few keys that differ
(`provider`, resolved `steps`/`epochs`, trimmed `samplePrompts`). The request
builder picks keys by name, so extra UI-only keys ride along harmlessly and no
future field can go missing the same way.

**Cancel and clear ignored which job you clicked.** `cancelTraining(jobId)` took
a job id and never sent it; the routes forwarded nothing. The sidecar then fell
back to its "focus" job — the running one, else the oldest queued — so with two
jobs queued, cancelling the second one cancelled the running one instead.
`clearTrainingJob` had the same shape, where omitting the id means "clear *all*
terminal jobs".

The sidecar already supported per-job targeting (`cancel_job(job_id)` handles
queued and running). `job_id` is now threaded through both routes as a query
parameter.

### Drift: the section↔field map was written out four times

`FIELD_REGISTRY` declares each field's section, and three other places
re-derived the same mapping by hand: `resetSection`, `selectSectionHasChanges`,
and the launch payload. They had already drifted — `resetSection('learning')`
reset `durationMode` and `steps` while `selectSectionHasChanges.learning`
checked neither, so changing either left the section showing no change dot and
no reset button, while the reset it declined to offer would have reverted them.

Now:

- `FIELD_REGISTRY` is keyed by literal field names (via a `defineFields` identity
  helper) and exports `TrainingFieldName`.
- `store/training-config/types.ts` carries a compile-time assertion that
  `TrainingFieldName` and `keyof FormState` describe the same set. Adding a field
  to one and not the other is a type error. (Verified by deliberately breaking it.)
- `getSectionFields(section)` drives both `resetSection` and
  `selectSectionHasChanges`, with two small documented exemption sets:
  `RESET_EXEMPT_FIELDS` (identity, not settings — model, backend, output name,
  datasets) and `CHANGE_EXEMPT_FIELDS` (adds `networkDimAlphaLinked`, a UI-only
  link toggle that must not light up the change dot).
- `SectionName` is now an alias of the registry's `ConceptualGroup` rather than a
  second declaration of the same seven strings.

Because `visibleFields` is now `Set<TrainingFieldName>`, the 94
`satisfies keyof FormState` annotations scattered through the section components
became redundant and were removed — a typo'd field name is caught by `.has()`
directly.

`selectedProvider` was missing from the registry entirely; it now has an entry
(`whatToTrain`, no default), which is what made the assertion pass.

### Repetition

- **`SectionHeaderExtra`** — the change-dot + "N hidden settings customised"
  block was copy-pasted into all 7 sections.
- **`NumberField`** — ~16 near-identical `FieldTitle` + `Input` + parse-guard +
  hint blocks across the Learning and Performance sections. This also fixed a
  real UX bug: the old guards committed straight to the store behind a
  `parseFloat` check that dropped anything not already valid, so clearing a field
  or typing an intermediate value (`0.`, `1e-`) had the keystroke rejected before
  it reached the DOM. The component now holds a local draft while editing,
  commits on any keystroke that parses in range, and drops the draft on blur so
  the display re-syncs with the store. A `validate` escape hatch covers the two
  fields with exclusive bounds (flow shift `> 0`, EMA decay strictly `0..1`).
- **`valuesDiffer`** moved to `services/training/field-compare.ts`. The
  hidden-changes count had its own weaker copy without the numeric coercion, so
  it could disagree with the per-field reset affordance.
- **`deriveCadenceSteps`** — `deriveCheckpointSteps` and `deriveSampleSteps` were
  the same 25-line algorithm over different config keys.
- `hydrateActiveTraining` hoisted its ten repeated
  `(cfg.hyperparameters as Record<string, unknown>)?.x` casts into one `hp`.

### Dead code

- **`training-sidecar/providers/ai_toolkit.py` deleted** (802 lines). The
  `AiToolkitProvider` class was never registered — `main.py` only wires
  `AiToolkitUiProvider`. The file survived because `ai_toolkit_ui` imported
  `SUPPORTED_MODELS` and six helpers from it, all underscore-prefixed despite
  being a cross-module API. Those ~100 live lines moved to
  `providers/ai_toolkit_common.py` with public names; the dead class, its
  `_find_python`, and its `_parse_eta_seconds` (which was byte-identical to
  Kohya's) went with it.
- **`collect_new_samples` shared** — the claim-once-and-archive loop was
  identical in both providers apart from which scan function it called. It now
  lives in `sample_archive.py` alongside `copy_into_run_archive`, taking `scan`
  and `parse` callables. The per-provider `_scan_*`/`_parse_sample` genuinely
  differ (different folder layouts and filename grammars) and stayed put.
  Verified end-to-end for both layouts: claims only its own prefix, parses
  step/epoch/prompt, archives, and stays idempotent across sweeps.
- **`'musubi'` removed** from `TrainingProvider`. Declared with two label entries
  but no model listed it and no sidecar provider implemented it — it widened
  every `Record<TrainingProvider, …>` obligation for nothing.
- Unexported or deleted: `selectIsGpuBusy` (leftover from removing the
  client-side GPU gate), `selectActiveTrainingJob`, `getTrainingProjectsRoot`,
  `SAMPLE_SAMPLER_ITEMS`, `BACKEND_BADGE_CLASS`, `SETTLE_STEPS`,
  `TrainingSettings` (fully unused), `TrainingHyperparameters`,
  `TrainingDataset`, `ModelComponent`, `SidecarStatus` (a stale twin of the live
  one in `shared/global-menu/use-sidecar-status.ts`), `FolderAugmentKey`.
- `ModelPaths` was declared identically in `services/training/types.ts` and
  `store/training-config/types.ts`; the store now re-exports the services one.
- The stale "backwards compatibility" re-export block in
  `use-training-config-form.ts` lost its two consumer-less entries.
- Stale doc references to the deleted `ai_toolkit.py` in `kohya.py` and
  `ai_toolkit_ui.py`, and a leftover "Informational preview of Kohya bucketing"
  docstring sitting above `PerformanceSection`.
- `forgetJob()` now prunes the three per-job `Map`s in the WS singleton, which
  previously grew for the life of the page.
- The `ThunkDispatch` type declaration that sat in the middle of
  `training-runtime.ts`'s import block moved below it.

---

## Deferred

### Splits

**`shared/activity-panel/helpers.ts` (395 lines)** is three unrelated concerns
under one name, with nothing crossing between the groups:

- tagging-job helpers — `isCaptionJob`, `getTaggingPreloadPhase`,
  `deriveTaggingBar`, `deriveTaggingStatusLabel`
- training-progress derivations — `splitPrunedCheckpoints`, `deriveSavedCount`,
  `deriveExpectedCheckpointCount`, `deriveSampleEventCount`,
  `deriveSampleImageSteps`, `deriveSecPerStep`, `trimSettleSteps`,
  `isSamplingPhase`, `formatSamplingLabel`
- generic formatters — `formatEta`, `formatEtaClock`, `formatPct`, `formatLoss`,
  `formatSecPerIt`, `formatDuration`, `formatBytes`

Suggested cut: `tagging-helpers.ts` / `training-progress.ts` / `format.ts`.
While there, `formatEta(seconds)` and `formatDuration(ms)` are near-duplicates
with subtly different rules (`formatEta` drops a trailing `0s`) — worth deciding
whether that difference is deliberate.

**Provider `start_training` methods.** `KohyaProvider.start_training` is ~480
lines with a ~300-line `_build_cli_args` beside it;
`AiToolkitUiProvider.start_training` is ~390. Both are long stream-parsing loops
that tangle sample discovery, checkpoint discovery, log handling and progress
emission. Not urgent, but they're the least navigable code in the stack.

**`services/training/models.ts` (792 lines)** mixes model definitions,
`OPTIMIZER_OPTIONS`, `SCHEDULER_OPTIONS` and `ARCHITECTURE_LABELS`. Mostly
inherent to being a registry; splitting the optimizer/scheduler catalogues out
would be a marginal win.

### Minor

- `resetSection('whatToTrain')` is unreachable: `selectSectionHasChanges`
  hardcodes it `false` and `ModelSelectSection` is passed neither `hasChanges`
  nor `onReset`. Same for `'sampling'` and `'saving'`, whose sections don't
  consume `hasChanges` either — the selector computes those two behind an
  `isLoaded` gate that nothing reads. Either wire up the reset affordance for
  those sections or drop the cases.
- `ModelDefinition.hiddenFields` is typed `(keyof TrainingDefaults)[]` and
  matched against `meta.defaultKey`, so any field with `defaultKey: null`
  (`networkType`, `samplingEnabled`, `saveMode`, …) can't be hidden per-model
  even where that would make sense. Keying `hiddenFields` on `TrainingFieldName`
  instead would lift the restriction.
- `mapStatus` in `training-runtime.ts` is an identity function kept as a
  deliberate seam against future drift between the sidecar and client status
  enums. Harmless; noted so it isn't mistaken for an oversight.
- `formsEqual` compares by `JSON.stringify`, which is key-order sensitive. It's
  safe today (object spread preserves the position of existing keys, and the
  baseline is usually the same reference), but it's a fragile guarantee for a
  function that decides whether the reset button is enabled.
- Knip still reports dead exports outside the training stack — in
  `services/auto-tagger`, `store/assets`, `tagging/utils` and `utils/`. Out of
  scope for this sweep.
- `workers/onnx-tagger.js` is knip's one unused *file*; it's loaded at runtime by
  path rather than imported, so this is a known false positive.

---

## Verification

`pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm knip` and `pnpm build` all clean.
Sidecar modules import cleanly and both providers' sample collection was
smoke-tested against real folder layouts. No end-to-end training run was
performed as part of this sweep — the launch-payload and cancel changes touch
live paths and are worth exercising on a real run.
