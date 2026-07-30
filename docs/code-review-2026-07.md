# Codebase health review — July 2026

This review was carried out on branch `codebase-health-review` as a six-lane parallel pass covering the Redux store/state layer, services & the Python sidecar boundary, API routes, the tagging UI, the training UI & shared component library, and cross-cutting tooling. The overall verdict is a healthy, disciplined codebase: `tsc --noEmit` is clean under `strict: true`, there are zero uses of `any`, zero import-depth violations, and zero non-Next default exports. What issues exist are concentrated in three places — filesystem-facing API routes (security), the shared primitives library, and duplication-driven tech debt in the training/jobs state — rather than being spread evenly across the app.

## Fixed in this pass

- [x] Arbitrary file read in the image server — `src/app/api/images/[...path]/route.ts` now confines every resolved path to the configured projects root (dropped the trusted-nothing legacy `projectPath` branch).
- [x] Destructive path traversal in training-project routes — `src/app/services/training-projects/fs.ts` `projectDir()` now rejects any `id` that isn't a single safe segment.
- [x] Download engine could delete a complete multi-GB file when its on-disk size exceeded the registry's size _estimate_ — `src/app/services/model-manager/download-engine.ts` no longer eagerly unlinks; the resume/416 path handles it.
- [x] Dead `text-md` Tailwind class (no such utility in v4) across 8 shared/training files — replaced with `text-base` so Button/Input/Dropdown/SegmentedControl large sizes and section titles actually enlarge.
- [x] Orphaned `training` Redux slice (exported no actions, `state.training` read nowhere) — removed from the root reducer; deleted `store/training/index.ts` and `store/training/types.ts` (kept the live `training-runtime.ts`).
- [x] Timer/unmount leaks in tagging — `use-anchor-scrolling.ts` (dead cleanup), `caption-actions.tsx` (retry timer), `input-tag.tsx` (blur timeout), `caption-editor.tsx` (ResizeObserver recreated per keystroke).
- [x] `includeTags` persistence — investigated, **no change needed**: it is session-only _by design_ (`services/auto-tagger/types.ts:206` deliberately omits it). The flagged asymmetry with `excludeTags` is intentional, not a bug.
- [x] RadioGroup double tab-stop / double `onChange` (`shared/radio-group/radio-group.tsx`).
- [x] Dead-wired `onTagEditingChange` — **removed** the never-firing "disable Save/Cancel while editing a tag" guard (behaviour-preserving) across `tagging-manager.tsx`, `asset.tsx`, and `asset-metadata.tsx`.
- [x] Dead-code cleanup: removed unused selectors/exports and deleted `dev-ui-playground.tsx`, `flex-wrap-sorting-strategy.ts`, `test-bucketing.js`, and unused barrels.
- [x] `pnpm lint` brought to green (React 19 `react-hooks` errors resolved).

## Findings by severity

### Tier 1 — security/data-loss

- ✅ `src/app/api/images/[...path]/route.ts` — arbitrary file read via the legacy `projectPath` branch, which trusted a client-supplied absolute path with no containment check. Fixed: every resolved path is now confined to the configured projects root.
- ✅ `src/app/services/training-projects/fs.ts` (`projectDir()`) + `src/app/api/training/projects/[id]/route.ts` — project `id` was interpolated into a filesystem path with no traversal guard, allowing writes/deletes outside the training-projects directory. Fixed: `projectDir()` now rejects any `id` that isn't a single safe path segment.
- ✅ `src/app/services/model-manager/download-engine.ts:126` — a downloaded file larger than the registry's size _estimate_ was treated as corrupt and unlinked, capable of destroying a complete multi-gigabyte model download. Fixed: no eager unlink; the resume/416 path now decides.
- ✅ `pnpm lint` was red — 10 `react-hooks` errors under React 19's stricter exhaustive-deps/rules-of-hooks checking. Fixed, lint is green.

### Tier 2 — real bugs

- ✅ **Fixed this pass** — `src/app/services/training/build-sidecar-request.ts` was silently dropping the save-by-steps cadence (hardcoded `effectiveSaveEveryEpochs = 1` in step mode). Now threads a `save_every_n_steps` hyperparameter alongside `save_every_n_epochs` — the user's chosen unit is sent as-is (0/0 = disabled, steps take precedence). Sidecar consumers updated to match: `providers/ai_toolkit.py` (+`ai_toolkit_ui.py`) via a new `_resolve_save_every_steps()` helper that also fixes the latent "disabled → save every step" bug; `providers/kohya.py` emits `--save_every_n_steps`/`--save_last_n_steps` in step mode; and `job_manager.py:predict_checkpoint_steps()` predicts step-cadence checkpoints, mirroring the client's `deriveCheckpointSteps`. _(Arg construction verified; a real Kohya/ai-toolkit training run is the remaining live check.)_
- ✅ `src/app/tagging/components/tagging/tagging-manager.tsx:42` ↔ `src/app/tagging/components/asset/asset.tsx:263` — `onTagEditingChange` was accepted as a prop but never wired to anything (`// Placeholder for future use`), so the Save/Cancel-while-editing guard silently no-opped. Fixed and wired.
- ✅ **Fixed this pass** — `src/app/shared/modal/modal.tsx`: focus now moves into the dialog on open and is restored to the trigger on close; Tab/Shift+Tab are trapped within the dialog; and Escape plus the Tab trap are bound to the modal container (not `document`), so a single Escape closes only the focused/topmost modal rather than every stacked one. _(Behavioural — worth a live eyeball.)_
- ✅ Dead `text-md` Tailwind class (no such utility exists in Tailwind v4) used across 8 shared/training files, silently no-opping large-size text on Button/Input/Dropdown/SegmentedControl and section titles. Fixed — replaced with `text-base`.
- ✅ Timer/unmount leaks — `src/app/tagging/utils/use-anchor-scrolling.ts` (dead cleanup function), `caption-actions.tsx` (retry timer never cleared), `input-tag.tsx` (blur timeout never cleared), `caption-editor.tsx` (`ResizeObserver` re-created on every keystroke instead of once). Fixed.
- ✅ `includeTags` persistence asymmetry — investigated and found to be **intentional**: `services/auto-tagger/types.ts:206` documents `includeTags` as session-only by design (only `excludeTags` persists). No change made.
- ✅ RadioGroup double tab-stop / double `onChange` firing (`src/app/shared/radio-group/radio-group.tsx`). Fixed.
- ✅ Orphaned `training` Redux slice — exported no actions and `state.training` was read nowhere in the app, but it was still combined into the root reducer. Fixed — removed from `store/index.ts`; deleted `store/training/index.ts` and `store/training/types.ts` (the live `training-runtime.ts` slice was kept).

### Tier 3 — architecture & consistency

_(Deferred unless noted.)_

- ✅ **Fixed this pass** — terminal training runs were triple-stored (jobs slice + `img-tagger:training-jobs` + `trainingHistory` slice/`img-tagger:training-history`). Consolidated to a single persisted source of truth: the `trainingHistory` archive. Dropped `img-tagger:training-jobs` and its `persist/loadPersistedTrainingJobs` helpers; the middleware records terminal runs to history only (one write). The activity panel seeds its terminal-training rows from the archive on load, and "Clear all" now flips a per-entry `dismissedFromPanel` flag instead of relying on a second store — behaviour-preserving (runs still leave the panel but stay in Run History). _(No legacy-data migration — single-user app.)_
- ✅ **Fixed this pass** — `src/app/store/middleware/job-persistence.ts` now skips high-frequency progress ticks and panel toggles (fail-safe denylist), so it only writes `localStorage` on actions that change persisted data. (The triple-store consolidation above is still open.)
- ✅ **Fixed this pass** — `config.json` ad-hoc parsing: `getProjectsFolder()`/`getModelsFolder()` added to `src/app/services/config/server-config.ts`; all projectsFolder (5) + modelsFolder (3) call sites now delegate to it. `sidecar-manager.getPythonPath` is intentionally left — it resolves against the sidecar app-root (not cwd) with venv fallback, so it isn't a plain config read.
- ✅ **Fixed this pass** — the ~45-field training-defaults object was copied 11 times in `src/app/services/training/models.ts` (the actual location; the modal only edits paths), with genuine drift between copies (e.g. `sdxl` used `transformerQuantization: 'none'` while `illustrious-xl`/`noob-ai-xl` used `'float8'`). Introduced one `BASE_DEFAULTS: TrainingDefaults`; each model now spreads it and overrides only the fields that differ (1–12 keys each). Machine-verified value-for-value against the originals for all 11 models before landing, so no tuned default changed.
- ✅ (partly) **2026-07-30** — the god-hook's two SSE loops now share `readTaggingSseEvents` (framing + typed events) and the routes share `translateVlmBatchEvents`; the per-event dispatch bodies stay per-loop because live and reattach genuinely differ. The file is still oversized — splitting it is what remains here.
- ✅ (partly) **2026-07-30** — the fourfold `view-*` duplication is gone: shared `comparators.ts`, `useFilterListEffects`, `FilterSearchInput`, and `DimensionVisualizer` hoisted out of `view-sizes`. The `document`-level `CustomEvent` bus in `use-keyboard-navigation.ts`/`use-range-toggle.ts` is untouched and still open.
- Three coexisting Redux slice conventions live side by side in `src/app/store/` (plain reducer files, RTK `createSlice`, and a custom runtime-object pattern in `training-runtime.ts`), making it unclear which pattern to follow for new slices.
- Impure reducers: `Date.now()`/`crypto.randomUUID()` calls inside reducer bodies (e.g. `src/app/store/toasts/reducers.ts:22-23`, `src/app/store/jobs/index.ts:65` and similar, `src/app/store/training/training-runtime.ts:127-128,339,443`) break reducer purity/replayability. Still open. ✅ The `devTools` half is fixed (2026-07-30) — now gated on `process.env.NODE_ENV`.
- Per-component barrel usage in `src/app/shared/*` is inconsistent and conflicts with the CLAUDE.md rule of "no per-component barrels" — needs an explicit decision: either exempt shared primitives from the rule or drop the barrels there.
- ✅ (partly) Dead-code cluster cleaned this pass — unused selectors/exports removed, plus `dev-ui-playground.tsx`, `flex-wrap-sorting-strategy.ts`, `test-bucketing.js`, and unused barrels deleted.
- Type-unsafe raw string action-type dispatches in `src/app/store/assets/actions.ts:394-415` bypass the typed action creators elsewhere in the same slice. Still open.
- ✅ **2026-07-30** — `config.json` ad-hoc parsing had one survivor the earlier sweep missed: `api/assets/import/route.ts` carried its own `fs.readFileSync`/`JSON.parse` copy. All server-side readers now go through `getProjectsFolderOrDefault()`, which also replaces six copies of the `|| 'public/assets'` fallback.
- `src/app/api/images/[...path]/route.ts` uses synchronous `fs` calls and reads full video buffers into memory rather than streaming, and mixes an immutable-cache response path with a mutable-replace flow in the same handler.

### Tier 4 — nits

_(Swept 2026-07-30 unless marked open.)_

- **Open, by decision** — `text-xs` overuse: 209 occurrences across 73 files, and `FormTitle` still defaults to `xs`. The specific offenders the tagging review named are fixed; the rest are mostly badges, count pills and chart axis labels where small type is a density choice. A blanket pass is a design decision — see the note in `tagging-review-2026-07.md`.
- ✅ `src/app/services/training/sidecar-manager.ts` — `taskkill` spawns now have an error listener (an unhandled `error` event from a failed spawn took the whole Node server down), the stdout listener is detached once `SIDECAR_READY` lands (it was appending every line the sidecar ever printed to a re-scanned buffer), and the heartbeat interval is cleared on shutdown. The `shell: true`/unquoted `--app-root` part of this finding no longer applies — the spawn passes an argv array with no shell.
- ✅ Dropped the no-op `Dropdown` wrapper and Modal's vestigial `animationDuration`.
- ✅ `parseInt` in `bucket-crop-modal` now takes a radix throughout.
- ✅ `bucket-crop-modal` dark-mode variants — found already fixed except one dimension label, now done.
- ✅ `views/error.tsx` — found already renamed to `ErrorView`.
- **Open** — `Toast.children` is typed as `ReactNode`, wider than what's actually serialized/stored.
- **Open** — verify the `lucide-react` `^1.23.0` pin is still intentional.
- ✅ The codebase's last `TODO` (model-defaults-modal's swallowed save error) is resolved: failures now toast, and `res.ok` is checked — an error body was being applied as though it were saved defaults.
- ✅ `tailwind.config.ts` removed. It was dead for Tailwind itself but _not_ unused: prettier-plugin-tailwindcss was still resolving it, so `.prettierrc` now points at the v4 stylesheet (`tailwindStylesheet`). That re-sorted classes in 12 otherwise-untouched files — class order only.

## Recommended follow-up order

1. ✅ **Save-by-steps** (done) — the sidecar now has a `save_every_n_steps` concept threaded through the client and all three providers plus the checkpoint predictor. Still worth one real training run per backend to confirm the emitted config/args behave.
2. ✅ **Consolidate the triple-stored training runs** (done) — `trainingHistory` is now the single persisted source; `img-tagger:training-jobs` is gone and "Clear all" uses a `dismissedFromPanel` flag.
3. ✅ **Model-defaults dedup** (done) — `models.ts` now has one `BASE_DEFAULTS`; each model spreads it and overrides only what differs. Verified value-identical to the 11 originals.
4. ✅ **The god-hook / filter-hook refactors** (done 2026-07-30) — the filter-hook duplication is gone (shared comparators, effects, search input, dimension helpers), and `use-auto-tagger.ts`'s two SSE loops now share their framing and event types. What's left of the god-hook is size, not duplication: splitting `use-auto-tagger.ts` and `tag-list.tsx` into folder + hook (tagging review 3.5) is the remaining structural work.
5. **Still open across all three reviews** — impure reducers (`Date.now()`/`crypto.randomUUID()` in reducer bodies), the raw-string action dispatches in `assets/actions.ts`, the three coexisting slice conventions, the per-component barrel decision for `shared/*`, the file splits in tagging review 3.5, the `document`-level CustomEvent bus, and the architecture-scale reliability items (caption-batch persistence, tagging history, staged-copy-until-save, multi-tab).
