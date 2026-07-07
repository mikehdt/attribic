# Codebase health review — July 2026

This review was carried out on branch `codebase-health-review` as a six-lane parallel pass covering the Redux store/state layer, services & the Python sidecar boundary, API routes, the tagging UI, the training UI & shared component library, and cross-cutting tooling. The overall verdict is a healthy, disciplined codebase: `tsc --noEmit` is clean under `strict: true`, there are zero uses of `any`, zero import-depth violations, and zero non-Next default exports. What issues exist are concentrated in three places — filesystem-facing API routes (security), the shared primitives library, and duplication-driven tech debt in the training/jobs state — rather than being spread evenly across the app.

## Fixed in this pass

- [x] Arbitrary file read in the image server — `src/app/api/images/[...path]/route.ts` now confines every resolved path to the configured projects root (dropped the trusted-nothing legacy `projectPath` branch).
- [x] Destructive path traversal in training-project routes — `src/app/services/training-projects/fs.ts` `projectDir()` now rejects any `id` that isn't a single safe segment.
- [x] Download engine could delete a complete multi-GB file when its on-disk size exceeded the registry's size *estimate* — `src/app/services/model-manager/download-engine.ts` no longer eagerly unlinks; the resume/416 path handles it.
- [x] Dead `text-md` Tailwind class (no such utility in v4) across 8 shared/training files — replaced with `text-base` so Button/Input/Dropdown/SegmentedControl large sizes and section titles actually enlarge.
- [x] Orphaned `training` Redux slice (exported no actions, `state.training` read nowhere) — removed from the root reducer; deleted `store/training/index.ts` and `store/training/types.ts` (kept the live `training-runtime.ts`).
- [x] Timer/unmount leaks in tagging — `use-anchor-scrolling.ts` (dead cleanup), `caption-actions.tsx` (retry timer), `input-tag.tsx` (blur timeout), `caption-editor.tsx` (ResizeObserver recreated per keystroke).
- [x] `includeTags` persistence — investigated, **no change needed**: it is session-only *by design* (`services/auto-tagger/types.ts:206` deliberately omits it). The flagged asymmetry with `excludeTags` is intentional, not a bug.
- [x] RadioGroup double tab-stop / double `onChange` (`shared/radio-group/radio-group.tsx`).
- [x] Dead-wired `onTagEditingChange` — **removed** the never-firing "disable Save/Cancel while editing a tag" guard (behaviour-preserving) across `tagging-manager.tsx`, `asset.tsx`, and `asset-metadata.tsx`.
- [x] Dead-code cleanup: removed unused selectors/exports and deleted `dev-ui-playground.tsx`, `flex-wrap-sorting-strategy.ts`, `test-bucketing.js`, and unused barrels.
- [x] `pnpm lint` brought to green (React 19 `react-hooks` errors resolved).

## Findings by severity

### Tier 1 — security/data-loss

- ✅ `src/app/api/images/[...path]/route.ts` — arbitrary file read via the legacy `projectPath` branch, which trusted a client-supplied absolute path with no containment check. Fixed: every resolved path is now confined to the configured projects root.
- ✅ `src/app/services/training-projects/fs.ts` (`projectDir()`) + `src/app/api/training/projects/[id]/route.ts` — project `id` was interpolated into a filesystem path with no traversal guard, allowing writes/deletes outside the training-projects directory. Fixed: `projectDir()` now rejects any `id` that isn't a single safe path segment.
- ✅ `src/app/services/model-manager/download-engine.ts:126` — a downloaded file larger than the registry's size *estimate* was treated as corrupt and unlinked, capable of destroying a complete multi-gigabyte model download. Fixed: no eager unlink; the resume/416 path now decides.
- ✅ `pnpm lint` was red — 10 `react-hooks` errors under React 19's stricter exhaustive-deps/rules-of-hooks checking. Fixed, lint is green.

### Tier 2 — real bugs

- **`src/app/services/training/build-sidecar-request.ts:144-151`** — save-by-steps cadence is silently dropped. When `saveMode === 'steps'`, the code hardcodes `effectiveSaveEveryEpochs = 1` instead of translating the user's `saveEverySteps` value, so a user-configured step interval never reaches the sidecar; the inline comment even claims "pass 0 here" but the code passes `1`. **Not yet fixed — deferred.** Suggested fix: thread `saveEverySteps` through to the provider's steps-based save path (or compute an equivalent epoch fraction) instead of hardcoding `1`.
- ✅ `src/app/tagging/components/tagging/tagging-manager.tsx:42` ↔ `src/app/tagging/components/asset/asset.tsx:263` — `onTagEditingChange` was accepted as a prop but never wired to anything (`// Placeholder for future use`), so the Save/Cancel-while-editing guard silently no-opped. Fixed and wired.
- ✅ **Fixed this pass** — `src/app/shared/modal/modal.tsx`: focus now moves into the dialog on open and is restored to the trigger on close; Tab/Shift+Tab are trapped within the dialog; and Escape plus the Tab trap are bound to the modal container (not `document`), so a single Escape closes only the focused/topmost modal rather than every stacked one. *(Behavioural — worth a live eyeball.)*
- ✅ Dead `text-md` Tailwind class (no such utility exists in Tailwind v4) used across 8 shared/training files, silently no-opping large-size text on Button/Input/Dropdown/SegmentedControl and section titles. Fixed — replaced with `text-base`.
- ✅ Timer/unmount leaks — `src/app/tagging/utils/use-anchor-scrolling.ts` (dead cleanup function), `caption-actions.tsx` (retry timer never cleared), `input-tag.tsx` (blur timeout never cleared), `caption-editor.tsx` (`ResizeObserver` re-created on every keystroke instead of once). Fixed.
- ✅ `includeTags` persistence asymmetry — investigated and found to be **intentional**: `services/auto-tagger/types.ts:206` documents `includeTags` as session-only by design (only `excludeTags` persists). No change made.
- ✅ RadioGroup double tab-stop / double `onChange` firing (`src/app/shared/radio-group/radio-group.tsx`). Fixed.
- ✅ Orphaned `training` Redux slice — exported no actions and `state.training` was read nowhere in the app, but it was still combined into the root reducer. Fixed — removed from `store/index.ts`; deleted `store/training/index.ts` and `store/training/types.ts` (the live `training-runtime.ts` slice was kept).

### Tier 3 — architecture & consistency

*(Deferred unless noted.)*

- Terminal training runs are triple-stored: once in the `jobs` slice, once across two separate `localStorage` keys, and again in the newer `trainingHistory` slice — three sources of truth for the same terminal-run data with no single reconciliation point.
- ✅ **Fixed this pass** — `src/app/store/middleware/job-persistence.ts` now skips high-frequency progress ticks and panel toggles (fail-safe denylist), so it only writes `localStorage` on actions that change persisted data. (The triple-store consolidation above is still open.)
- ✅ **Fixed this pass** — `config.json` ad-hoc parsing: `getProjectsFolder()`/`getModelsFolder()` added to `src/app/services/config/server-config.ts`; all projectsFolder (5) + modelsFolder (3) call sites now delegate to it. `sidecar-manager.getPythonPath` is intentionally left — it resolves against the sidecar app-root (not cwd) with venv fallback, so it isn't a plain config read.
- `src/app/training/components/model-defaults-modal/model-defaults-modal.tsx` — a ~60-field model-defaults object is copied 11 times with drift between copies, rather than derived from one source of truth.
- `src/app/services/auto-tagger/use-auto-tagger.ts` — a ~1,060-line god-hook with duplicated SSE streaming loops that could be consolidated into one shared streaming helper.
- Fourfold duplication of `view-*` filter hooks, plus a global `document`-level event bus for cross-component signalling (e.g. `src/app/tagging/components/top-shelf/filter-list/use-keyboard-navigation.ts:29` dispatches a `CustomEvent('filterlist:keyboardselect')` on `document` rather than lifting state or using a ref callback).
- Three coexisting Redux slice conventions live side by side in `src/app/store/` (plain reducer files, RTK `createSlice`, and a custom runtime-object pattern in `training-runtime.ts`), making it unclear which pattern to follow for new slices.
- Impure reducers and non-deterministic store config: `Date.now()`/`crypto.randomUUID()` calls inside reducer bodies (e.g. `src/app/store/toasts/reducers.ts:22-23`, `src/app/store/jobs/index.ts:65` and similar, `src/app/store/training/training-runtime.ts:127-128,339,443`) break reducer purity/replayability; separately, `devTools: true` is hardcoded in `src/app/store/index.ts:47` rather than gated on `process.env.NODE_ENV`.
- Per-component barrel usage in `src/app/shared/*` is inconsistent and conflicts with the CLAUDE.md rule of "no per-component barrels" — needs an explicit decision: either exempt shared primitives from the rule or drop the barrels there.
- ✅ (partly) Dead-code cluster cleaned this pass — unused selectors/exports removed, plus `dev-ui-playground.tsx`, `flex-wrap-sorting-strategy.ts`, `test-bucketing.js`, and unused barrels deleted.
- Type-unsafe raw string action-type dispatches in `src/app/store/assets/actions.ts:394-415` bypass the typed action creators elsewhere in the same slice.
- `src/app/api/images/[...path]/route.ts` uses synchronous `fs` calls and reads full video buffers into memory rather than streaming, and mixes an immutable-cache response path with a mutable-replace flow in the same handler.

### Tier 4 — nits

- `text-xs` overuse — 68 occurrences across 30 files — and `FormTitle` defaulting to `xs` sizing, which reads as visually cramped for a desktop app (see also the `feedback_text_sizing` project note against defaulting to tiny text).
- `src/app/services/sidecar-manager.ts` — the `taskkill` spawn has no error listener, runs with `shell: true` against an unquoted `--app-root` path, its stdout listener is never detached, and the heartbeat interval is never cleared on shutdown.
- `src/app/shared/dropdown/dropdown.tsx` — a no-op wrapper component; `src/app/shared/modal/modal.tsx` — a vestigial `animationDuration` prop that no longer does anything.
- `parseInt` without a radix in `bucket-crop-modal`.
- `bucket-crop-modal` uses light-only Tailwind classes with no `dark:` variants, inconsistent with the rest of the app's dark-mode support.
- `src/app/tagging/views/error.tsx:13` — `export const Error = (...)` shadows the global `Error` constructor; worth renaming (e.g. `ErrorView`) to avoid accidental shadowing in scope.
- `Toast.children` is typed as `ReactNode`, which is wider than what's actually serialized/stored and could admit non-serializable values into a Redux-adjacent path.
- Verify the `lucide-react` `^1.23.0` pin is still intentional.
- 1 `TODO` comment total in the codebase — worth a final sweep before considering the review closed.
- `tailwind.config.*` is now vestigial under Tailwind v4's CSS-first configuration and could likely be removed.

## Recommended follow-up order

1. **Save-by-steps** — `build-sidecar-request.ts:144-151` sends only `save_every_n_epochs`; the sidecar has no `save_every_n_steps` concept, so a user's "save every N steps" choice is silently dropped. Completing it is a **cross-language feature** (client + `ai_toolkit.py`, `ai_toolkit_ui.py`, `kohya.py`, and the `job_manager.py` checkpoint predictor), best verified with a real training run — not the quick fix first assumed.
2. **Consolidate the triple-stored training runs** — while the history feature is still fresh. (The `job-persistence` write-frequency half of this is now done.)
3. **Model-defaults dedup** — derive the 11-copy ~60-field defaults object from one source. (The `config.json` half of this is now done.)
4. **The god-hook / filter-hook refactors** — tackle `use-auto-tagger.ts` and the fourfold `view-*` filter hook duplication opportunistically, next time either area is touched for a feature change.
