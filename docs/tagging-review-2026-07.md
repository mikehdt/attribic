# Tagging Codebase Review — 2026-07-28

Four-area sweep: auto-tagger backend (services + API routes), top-shelf UI,
core tagging/asset UI, store + shared components. Findings verified against
the code (usages grepped before anything was called unused; edit propagation
traced before perf claims). The in-flight project-relative `displayName`
changes were checked and are correctly plumbed at every call site, including
the ONNX replay path — no changes needed there.

Severity: **P1** = real bug, fix before it bites · **P2** = visible UX/perf
problem · **P3** = tightening (dedup/structure) · **P4** = polish.

## Fix status (2026-07-28, same session)

**Fixed:** all of P1, all of P2, and P4 except the two items below. Verified
with `tsc --noEmit`, ESLint over changed files, and a production build.
Bonus fixes beyond the list: subfolder DOM ids had the same encoding bug as
tag ids; keyboard drag needed a pointer-free collision/placement path, not
just reachability; `promoteToRunning` needed an abort guard to fully close
the cancel race.

**Deferred to the P3 session:** all of P3, plus two behaviour-neutral P4
items that are really structural churn — modal reset-idiom convergence
(copy-tags was converged opportunistically; the rest ride with P3) and
save-button colour unification (possibly intentional colour-coding — decide
then). The `use-range-toggle` CustomEvent refactor also rides with P3.

**Still owed:** a manual pass over keyboard drag-reorder (tab to chip →
Space/Enter → arrows) and the caption draft debounce/flush, next time the
app is running.

---

## P1 — Real bugs

### 1.1 ONNX worker death without an `error` event wedges the tagging queue
`src/app/services/auto-tagger/providers/wd14/worker-manager.ts:43-50, 68-85, 119-143`
`readyPromise` is only rejected by the `error` listener; the `exit` handler
nulls state but settles nothing, and `sendMessage` doesn't listen for `exit`
either. A worker that dies without `error` (native onnxruntime/sharp abort,
`process.exit`) leaves the awaited promise pending forever → `processQueue`
stays `processing = true` → every later tagging request silently hangs.
Compounding: the mid-run batch stays `'running'` forever, `clearOnnxBatch`
409s on running batches, and `/batch/active` resurfaces an immortal zombie
until server restart. **Fix:** settle `readyPromise`/`sendMessage` on `exit`.

### 1.2 Cancel race resurrects jobs to a permanently stuck `running` state
`src/app/store/jobs/index.ts:193` + `src/app/tagging/components/auto-tagger/use-auto-tagger.ts:925, 996, 476, 929, 1079`
`updateTaggingProgress` unconditionally sets `status = 'running'`. The SSE
loop has await points during which a user cancel can land; the resuming loop
re-dispatches progress → status flips back to `running`, and the AbortError
path's `flushAndFinalise` early-returns without re-dispatching a terminal
status. Job stuck `running` forever; `selectActiveTaggingJob` then makes the
settings modal permanently redirect to the dead detail view. The two cancel
guards test `currentJobIdRef.current !== jobId`, but the ref is only nulled
in a `finally` that can't run mid-await — they never fire on real cancels.
**Fix:** make `updateTaggingProgress`/`recordTaggingResult` no-ops when the
job is already terminal (one reducer guard closes every window).

### 1.3 Cancel→clear handshake is a fixed 3-second sleep
`src/app/services/auto-tagger/tagging-controllers.ts:58-79`
After POSTing cancel it waits exactly 3000ms then POSTs clear once, no retry.
Slow inference exceeds 3s → clear 409s → cancelled batch never removed.
`adoptedBatchIds` is in-memory, so after refresh the reattach sweep re-adopts
the cancelled batch and applies its tags — the user cancelled but gets tags
anyway. **Fix:** poll until terminal (or server-side clear-on-terminal).

### 1.4 One failed asset save ejects the user from the tagging view
`src/app/store/assets/extraReducers.ts:103-106` + `src/app/providers/AppProvider.tsx:144-148` + `src/app/tagging/views/error.tsx:34`
`saveAsset.rejected` sets `IoState.ERROR`; AppProvider routes to `/` whenever
`ERROR && isTagging`, clearing state and discarding all other pending edits.
The error view even says "error occurred loading" for a save failure.
**Fix:** split save errors from load errors; surface save failures inline
(the amber dirty bar on `AssetMetadata` is a natural anchor) and stay on page.

### 1.5 Filter panel Clear button disagrees with the visible view
`src/app/tagging/components/top-shelf/filter-list/filter-controls.tsx:29-62`
- Size view, Buckets sub-view: click dispatches `clearBucketFilters` but
  disabled state comes from `filterCount.sizes` — with only bucket filters
  set the button is disabled (can't clear); with only size filters set it's
  enabled but a no-op.
- File view: panel shows name searches + subfolders + extensions, but Clear
  only dispatches `clearExtensionFilters` and disables on extension count.
- Title renders internal jargon ("Clear filetype filters").
**Fix:** derive disabled state and clear action from one view/sub-view map;
add a `clearFileFilters` reducer clearing all three classes.

### 1.6 Switching to Buckets resets the Images sub-view's sort (stale closure)
`src/app/tagging/components/top-shelf/filter-list/select-sizes-sub-view.tsx:30-32` + `filter-context.tsx:225-245`
`setSortType('count')` after `setSizeSubView(subView)` closes over the
pre-update sub-view, so the write lands on `sortSettings.size.dimensions` —
a user's Megapixels sort is lost every time they peek at Buckets, and the
intended Buckets reset never happens. **Fix:** drop the call or pass the
sub-view explicitly.

### 1.7 Caption editing dispatches to Redux per keystroke
`src/app/tagging/components/tagging/caption-manager.tsx:20-25`, `caption-editor.tsx:96-101`
Each keystroke mutates `state.assets.images` → `selectFilteredAssets`
re-filters/re-sorts all assets → `AssetList` regroups → all memo comparators
run (plus per-asset tag selectors in hybrid mode). O(assets × tags) JS per
keystroke; typing latency on large pages. **Fix:** local draft in
`CaptionEditor`, commit on blur/debounce.

### 1.8 Double-click mode drops a toggle when two different tags are clicked <200ms apart
`src/app/tagging/components/tagging/tag-list.tsx:755-773`
`handleToggleTag` clears any pending timer regardless of which tag owns it —
tag A's queued toggle is discarded. **Fix:** flush the pending toggle
immediately when the new click is on a different tag.

### 1.9 Duplicate batch ID clobbers a running ONNX batch
`src/app/services/auto-tagger/providers/wd14/batch-store.ts:70-87` + `batch/route.ts:107-109, 256-263`
`createOnnxBatch` unconditionally replaces existing state; a client
retry/double-submit interleaves two runners into one state object.
**Fix:** 409 when a running batch with that ID exists.

---

## P2 — UX and perf problems

### 2.1 Tagging detail modal has no cancel button
`src/app/shared/activity-panel/tagging-detail-modal/tagging-detail-content.tsx:108-114`
`onCancel` is declared, documented ("the button hides itself"), and threaded
from `activity-panel.tsx` down through `tagging-detail-modal.tsx` — but never
destructured or rendered. Since starting a batch lands straight in this view
and the activity panel hides behind it, cancelling requires close-modal →
reopen panel → card cancel. **Fix:** render a cancel button while running.

### 2.2 Tag-edit dead ends and Escape inconsistency across the three editors
`tag-list.tsx:730-739`, `input-tag.tsx:201-208`, `caption-editor.tsx`
Submitting an empty/duplicate edit silently does nothing (edit stays open,
other tags faded, no hint); `InputTag` blur only acts in add mode so a
clicked-away edit sticks open; the caption editor handles no keys (Escape
does nothing, vs cancel in both tag inputs). **Fix:** cancel-or-commit on
blur, Escape-to-blur in caption editor, hint on blocked submit.

### 2.3 Keyboard drag-reorder is configured but unreachable
`tagging-manager.tsx:101-103` + `tag-list.tsx:429`
`KeyboardSensor` is wired but `dndEnabled` requires mouse hover and disabled
`SortableTag`s strip listeners — keyboard users can never start a drag.

### 2.4 Hovering the tag strip remounts every chip
`tag-list.tsx:429, 499-538`
`dndEnabled = sortable && (isHovered || editing)` swaps the tree between
`DndContext > SortableTag` and bare `EditableTag` on every hover boundary —
full chip DOM recreated both ways, focus dropped. **Fix:** keep the tree
stable; toggle `useSortable`'s `disabled` instead.

### 2.5 Shift press re-renders every Asset on the page
`asset-list.tsx:87, 114-122` + `asset.tsx:295`
`handleAssetHover` deps include `isShiftHeld`; identity change fails all
Asset memos, and the key listeners re-subscribe per toggle. **Fix:** ref.

### 2.6 Batch save is O(N²) in re-render work
`asset-metadata.tsx:81`
Every `AssetMetadata` subscribes to global `selectSaveProgress`; each tick
re-renders all N bars and re-runs `selectFilteredAssets`. **Fix:** memoised
boolean selector.

### 2.7 Toolbar menu subscribes to full arrays while closed
`tag-actions-menu.tsx:51-52, 131-159`
Subscribes to `selectSelectedAssetsData` + `selectFilteredAssets` even with
all modals closed; `noSelectedAssetHasTags` and `overflowMenuItems` rebuilt
every render. **Fix:** boolean/count selectors for enablement.

### 2.8 Blank trigger phrases can be saved
`trigger-phrases-modal.tsx:48-54` — edit path doesn't trim/filter empties
(add path does); `""` gets written to project config.

### 2.9 Small but visible copy issues
- `move-to-folder-modal.tsx:307-309`: "3files would collide" (missing space).
- `views/error.tsx`: "loading" message shown for save failures (see 1.4);
  export named `Error` shadows the global.
- `asset-list.tsx:234-239`: filtered-empty state offers no clear-filters
  action (sibling empty states have actions).
- `tagging-detail-content.tsx:89-91`: "Caption for {fileId}" shown for ONNX
  tag batches displaying a tag list.
- `asset.tsx:193` "crop visualization" vs `tagging-bottom-shelf.tsx:100`
  "visualisation" — same control, two spellings; AU English for UI.
- Terminology drift: "Repeat Folders" / "Subfolders" / "folders"; "Name
  Search" vs "name filter".

### 2.10 Keyboard/a11y gaps
- `category-list.tsx`: no arrow-key navigation; `useListHighlight` exists and
  is wired into `Dropdown`/`MenuButton` but not here.
- Search inputs: `view-tags.tsx` has aria-labels; `view-sizes`, `view-buckets`,
  `view-file` don't — same widget, three levels.

### 2.11 Missing `projectPath` in batch request → 500 instead of 400
`batch/route.ts:117 vs 141-149` — `path.isAbsolute(undefined)` throws before
validation runs; the 400 branch is unreachable for this case. **Fix:** run
validation before path resolution.

---

## P3 — Tightening (dedup and structure)

### 3.1 `/api/auto-tagger/models` fetch implemented four times
`tag-actions-menu.tsx:62-96` (3-step backoff), `caption-actions.tsx:42-72`
(single 3s retry — comment says "same logic", it isn't), `use-auto-tagger.ts:182-191`,
`auto-tagger-tab.tsx:32-41`. All untyped. `caption-actions` also duplicates
~80 lines of `tag-actions-menu`'s button/gating. **Fix:** one typed
`createAsyncThunk` in the auto-tagger slice + shared button/hook. This also
lets the dead slice state (3.6) become live or be deleted.

### 3.2 VLM event→SSE translation duplicated between live and reattach routes
`batch/route.ts:501-581` vs `batch/attach/route.ts:110-161` — ~50 lines each,
already drifted (live includes `fileId` on `progress`/`loaded`; attach
doesn't, so reattached clients lose the "currently processing" label).
**Fix:** one shared translator.

### 3.3 Two hand-rolled SSE consumer loops in `use-auto-tagger.ts`, untyped events
`use-auto-tagger.ts:542-667` vs `818-1031`. Drift: reattach path lacks the
`loaded` settle transition, never applies `keepModelInMemory` unload, and
stamps `summary.providerType` from the *currently selected* provider rather
than the batch that ran. Events are `JSON.parse` → `any` on both loops while
the routes build the same eight shapes inline. **Fix:** shared stream
consumer + a `TaggingSseEvent` discriminated union in
`services/auto-tagger/types.ts` used by both routes and the client.

### 3.4 Four filter views duplicate ~200 lines
Sort comparator ×4 (`use-tags-view.ts:43-73`, `use-sizes-view.ts:120-168`,
`use-buckets-view.ts:59-91`, `use-file-view.ts:81-143`), `updateListLength` +
`scrollIntoView` effects ×4, search-input markup ×3. **Fix:**
`makeFilterComparator`, `useFilterListEffects`, `FilterSearchInput` — also
fixes the aria-label inconsistency (2.10) for free.

### 3.5 Oversized files carrying service/hook logic
- `batch/route.ts` (601 lines): both runners + trigger-phrase prompt builder
  belong under `services/auto-tagger`; also duplicated validation block with
  `tag/route.ts:24-54` and a repeated progress-emit block (356-364 vs 409-417).
- `tag-list.tsx` (939 lines): edit state, double-click timing, DnD
  choreography (module-level `pointerEdgeZone`/`dragPointer` globals),
  clipboard — wants the `tag-list/` folder + `use-tag-list.ts`/`use-tag-drag.ts`.
- `use-auto-tagger.ts` (~1,100 lines): see 3.3.
- `bucket-crop-modal.tsx` (515): bucket maths in component; width/height
  handlers are mirror-image duplicates; wants `use-bucket-crop-modal.ts`.
- `copy-tags-modal.tsx` (389): derivation in component; siblings all use the
  folder + hook pattern.

### 3.6 Dead state and reducers in the auto-tagger slice
`store/auto-tagger/index.ts:27-29, 77-84, 88, 92` — `setLoading`/`setError`/
`clearError` never dispatched, `selectIsLoading`/`selectError` never used,
`isLoading`/`error` fields never read. Delete or adopt via the 3.1 thunk.

### 3.7 Selector factories invoked inline defeat memoisation
`use-auto-tagger.ts:128-130`, `use-tagging-detail-modal.ts:18`,
`auto-tagger-tab.tsx:91` — fresh `createSelector` per render. No re-render
storms, but wasted recompute and a misleading pattern.

### 3.8 MultiTagInput contract wider than its implementation
`multi-tag-input.tsx:17-22` — only `isDuplicate` is consumed of the four
declared fields; the add-tags modal feeds it via a render-phase ref mutation
reconciled one keystroke late. **Fix:** slim the type; make input controlled.
Related: `duplicateTagInfoCache` (`combinedSelectors.ts:114-119`) grows one
selector per typed prefix, cleared only on project switch.

### 3.9 Bucket counting belongs in a selector
`use-buckets-view.ts:29-38` iterates `selectAllImages` in the hook; sizes get
this via memoised `selectImageSizes`. Add `selectBucketCounts`.

### 3.10 Smaller dedup/consistency items
- Redundant resets: `list-view-selector.tsx:37-41` re-clears what
  `filter-context.handleViewChange` clears; `clear-selection-button.tsx:26-31`
  re-implements the sort auto-switch effect.
- `view-buckets.tsx:10-12` imports shared pieces from `view-sizes.tsx` —
  hoist to filter-list level.
- Scroll math duplicated: `utils/scroll-to-anchor.ts` vs
  `use-anchor-scrolling.ts:19-36`; both use `setTimeout(100)` where rAF is
  the convention (`input-tag.tsx:206` too).
- `services/auto-tagger/index.ts:25` re-exports `VLM_VIDEO_QUALITY_PIXELS`
  with no consumer through the barrel.
- `components/auto-tagger/index.ts` per-component barrel (convention says none).
- Response envelopes: `batch/route.ts` hand-rolls `new Response(JSON...)` vs
  `NextResponse.json` everywhere else; `cancel/route.ts:29-35` returns 200
  for unknown IDs; `'public/assets'` fallback string duplicated;
  `getServerConfig()` one-call vestige; `loaded` event's
  `fileId: items[0]?.itemId` wrong after mid-queue resume.
- `editTag` reducer (`reducers.ts:219-220`) doesn't guard `findIndex === -1`.
- Adoption marking is fail-permanent (`use-auto-tagger.ts:704-706`) — a
  transient reattach failure means no retry until refresh.
- Terminal ONNX batches accumulate in the module map for process lifetime.
- `takeError` (`vlm/client.ts:304`) reads without clearing despite the name.

---

## P4 — Polish

- **text-xs sweep** (~44 occurrences in top-shelf alone; against stated
  preference): worst are `asset-counts.tsx:18` (primary readout),
  `filter-controls.tsx:68-84` (all three buttons), `edit-tags-modal.tsx:77-81`
  (text-xs where sibling add-tags uses text-sm for the same message),
  caption word count, hybrid section labels, tag count badge, "Per page",
  `tag-status-legend.tsx:36`, `tagging-detail-content.tsx:142` +
  `text-[11px]` at 230.
- `filter-list/README.md` documents components that don't exist
  (`FilterListProvider`, `SearchProvider`, …) and omits buckets/file views —
  actively misleading; update or delete.
- Modal state-reset idioms: four different patterns across seven modals;
  converge on the render-time `wasOpen` comparison.
- Primary-action colours: amber/indigo/teal/sky for equivalent "save"
  actions across sibling modals (destructive rose is consistent — keep).
- `bucket-crop-modal.tsx:332, 400, 453` missing dark-mode variants.
- DOM ids from raw tag text (`view-tags.tsx:70`) — spaces/quotes make
  invalid ids.
- `use-range-toggle.ts:128-144` document-level CustomEvent contract with
  keyboard nav — works, but invisible; a context callback would be traceable.
- `Asset` memo comparator omits `blurDataUrl` (`asset.tsx:281-318`).
- `'sentences'` caption-mode branch (`tagging-manager.tsx:78`) matches a
  commented-out switcher entry — legacy; comment or remove together.
- Reattach reconstructs `projectPath` more narrowly than the live route
  accepts (`attach/route.ts:93-98` vs `batch/route.ts:116-131`) — can't
  diverge under current constraints, but the live route's three-way
  resolution is broader than the contract.
- `copy-tags-modal.tsx:93-109` reset effect keyed on array identity rather
  than `isOpen`.

---

## What's in good shape (verified, not vibes)

- SSE lifecycle in the live batch route: `clientGone` guard, idempotent
  close, no events after close, failure finalisation on throw. Attach-route
  disconnect correctly unwinds through generator `finally` blocks.
- `consumeSocket` treats WebSocket close before terminal status as failure —
  sidecar death surfaces as an error, not a fake completion. Snapshot/live
  dedup via `seenItems` is sound on both providers.
- The memo-comparator chain for single-tag edits genuinely stops DOM-level
  fan-out (traced end to end); assets selectors are exemplary
  (weakMapMemoize, result-equality, stable empty sentinels).
- Modal/popup infrastructure is uniformly applied: Escape, backdrop, focus
  trap/restore, two-stage Escape in the filter list all work.
- Scoping (selected vs filtered) is coherent across Add/Edit/Move via
  `ScopingCheckboxes`; destructive flows are opt-in and rose-coloured.
- Icons uniformly `[Name]Icon`; named exports throughout; AU English in
  top-shelf UI text (the one "visualization" is in `asset.tsx`).
- The in-flight project-relative `displayName` work is correct at every call
  site; the ONNX replay path needs no plumbing (replays stored names).
