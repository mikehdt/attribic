# Training Sample Previews — Design

**Status:** agreed, ready to implement · 2026-07-24

Show the preview images both backends can generate during training (e.g. every
N steps) inside the training detail modal, live as they arrive, and keep them
per-run so Run History shows them after the fact.

---

## 1. Verified facts

### Backend support

Both backends support in-training sampling, and **we already request it** — the
Sampling config section (prompts, cadence, sampler, guidance, sample steps)
shipped 2026-07-10 and both providers wire it through. What's missing is
collection and presentation.

**ai-toolkit** (`BaseTrainProcess.py:45`, `BaseSDTrainProcess.py:273–298`):

- Writes to `<loras>/<output_name>/samples/`
  (`save_root = training_folder/name`; we pass `training_folder = <loras>`).
- Filename template: `[time]_<step>_[count].jpg` where `[time]` is a
  timestamp, `<step>` is zero-padded to 9 digits with a leading underscore
  (so effectively `__000000500`), `[count]` is the prompt index.
- Steps-only cadence (`sample_every`).

**Kohya sd-scripts** (`library/sampling.py:247–494`):

- Writes to `<output_dir>/sample/` — and since we pass
  `--output_dir=<loras>` (the shared root, `kohya.py:446`), that is
  **one shared folder for all Kohya runs**: `<loras>/sample/`.
- Filename: `{output_name}_{num_suffix}_{promptIdx:02d}_{timestamp}{_seed}.png`
  where `num_suffix` is `e%06d` (epoch-cadence) or `%06d` (step-cadence).
- Log output is only `generating sample images at step / …` — **no per-file
  path is ever printed**. The existing `"saved sample"` log parse in
  `kohya.py:860–864` never fires; it's dead code.
- Supports `--sample_every_n_epochs` natively (we currently only send steps).
- **Anima branch is covered**: `anima_train_network.py:236` +
  `library/anima_train_utils.py:503` implement sampling with the same dir and
  filename conventions (`anima_train_utils.py:555, 751–756`). SDXL goes
  through the common `sampling.py` path.

In both backends, step and prompt index are recoverable from the filename
alone. Filenames embed timestamps, so files are never overwritten across runs
— but they do accumulate and co-mingle.

### Current plumbing (half a transport, no consumers)

- Sidecar job status already carries `sample_image_paths: list[str]`
  (`models.py:100`).
- Kohya provider fills it via the dead log parse (never fires); the
  ai-toolkit provider declares the list and forwards it but **never appends**
  (`ai_toolkit_ui.py:504, 670`).
- Frontend maps it into Redux (`training-runtime.ts:140` →
  `TrainingProgress.sampleImagePaths`, `services/training/types.ts:75`) and
  **nothing renders it**.
- Progress reaches the browser over a **direct WebSocket to the sidecar**
  (`training-runtime.ts:161`) — no Next.js hop in between.

### The epochs toggle

The form's Epochs/Steps cadence toggle stores `sampleEveryEpochs`, but
`build-sidecar-request.ts:212` only ever sends `sample_every_n_steps`, and
`kohya.py:664` hardcodes that flag. So epochs mode is currently a no-op that
silently samples at the (possibly stale) steps value.

**Decision: wire it**, mirroring the save-cadence dual-field pattern
(`build-sidecar-request.ts:155–162`): send `sample_every_n_epochs` /
`sample_every_n_steps` with the inactive unit zeroed. Kohya passes
`--sample_every_n_epochs` natively; the ai-toolkit provider fakes epochs the
same way training duration already does — it converts to steps using the
effective steps/epochs it already derives for the UI (`_derive_epoch`), since
`sample_every` is steps-only.

---

## 2. Collection — scan directories, don't scrape logs

Replace the log-parse approach with the scan-diff pattern the ai-toolkit
provider already uses for checkpoints (`_scan_checkpoints`): each poll/step,
list the sample dir, diff against a seen-set seeded at job start (so
pre-existing files from earlier runs are never claimed).

- **ai-toolkit**: scan `<output_path>/<output_name>/samples/`.
- **Kohya**: scan `<output_path>/sample/` filtered to the
  `{output_name}_` prefix (shared dir).

Because each provider knows its own filename grammar, the sidecar parses it
and emits **structured entries** instead of bare strings:

```python
class SampleImage(BaseModel):
    path: str          # relative to output_path (the loras root)
    step: int          # 0 if unknown
    epoch: int | None  # Kohya epoch-cadence runs only ("e000012")
    prompt_index: int
```

`models.py`: replace `sample_image_paths: list[str]` with
`samples: list[SampleImage]`. Nothing consumes the old field, so this is a
clean swap (mirror in `services/training/types.ts` and
`training-runtime.ts`).

**Paths are emitted relative to `output_path`** (the loras root the request
handed the provider). The client receives them over the direct WS and can
build a URL without knowing the machine's absolute layout, and the serving
route (§4) resolves them against the same root. No client-side path math.

Prompt text: the client already has `samplePrompts` in the job's config
snapshot, so `prompt_index` is enough — the UI joins them locally.

Known limitation: a **resumed** run's earlier-leg samples predate the
seen-set seed, so they aren't claimed by the new job. Same behaviour as
checkpoint detection today; acceptable.

---

## 3. Per-run retention — archive on terminal

Two problems with leaving files where the trainers drop them:

1. Kohya's `<loras>/sample/` is shared across every run — attribution exists
   only in our heads (well, in the scan-diff) at run time.
2. Run History should own its images: deleting a history entry should delete
   them, and a later run of the same LoRA name shouldn't tangle with them.

**Proposal: move samples into a per-run archive when the run goes terminal.**

- Location: `<loras>/.run-samples/<jobId>/`, normalised names
  `s{step:06d}-p{promptIndex:02d}[-e{epoch}].{ext}` (metadata survives in the
  name; no manifest file needed).
- Trigger: the job-persistence middleware already upserts terminal training
  runs into the history slice — at that moment it also fires
  `POST /api/training/samples/archive` with `{jobId, paths}` (the structured
  entries from the final status). The route moves the files (same-volume
  rename, cheap) and returns the archived names; the middleware records them
  on the history entry before it's persisted.
- The history snapshot (`TrainingHistoryEntry` = full `TrainingJob`) already
  carries `progress.samples`, so the history detail view renders from the
  same data as the live view — just resolved against the archive dir.
- **Deletion**: `deleteHistoryEntry` / `clearHistory` fire
  `DELETE /api/training/samples/<jobId>` (fire-and-forget, tolerate 404).
  The activity panel's "Clear all" only dismisses — files stay, correctly.

Why move rather than leave-in-place + delete-individually: the loras folder
stays clean (no ever-growing `sample/` dump), deletion is `rm -rf` of one
folder, and archived runs are immune to any future backend behaviour change
in the shared dir. The cost is that samples are no longer where the raw
trainer left them — acceptable since our UI becomes the way you look at them.

**Open question — orphans.** History lives in localStorage; if the browser
store is cleared, `.run-samples/<jobId>/` folders orphan. Options: (a) ignore
— it's a local app, folders are small and findable; (b) on history restore,
list archive dirs and sweep any not present in the store. I'd start with (a)
and note it; sidecar-side history (already deferred to the queueing
milestone) would eventually make this moot by moving ownership server-side.

Edge case: with no configured `projectsFolder`, outputs fall back to
`{trainingRoot}/outputs` — the archive and serving root go through the same
resolver (`getLoraOutputRoot`), so behaviour is consistent.

---

## 4. Serving — one confined route

New route: `GET /api/training/samples/[...path]`, rooted at the loras dir
(same resolver as above), with the same `isWithin` confinement as
`/api/images` (`api/images/[...path]/route.ts:10–13`). It covers all three
locations because they're all under the root:

- live ai-toolkit: `<name>/samples/<file>`
- live Kohya: `sample/<file>`
- archive: `.run-samples/<jobId>/<file>`

Filenames are timestamped/immutable → `Cache-Control: immutable` is safe.
No thumbnail generation: a run yields dozens of ~1MP images at most; lazy
`<img loading="lazy">` scaled by CSS is fine for a local app.

Not reusing `/api/images`: it's semantically "project assets by
projectName", and its cache-forever contract plus query-param shape fit
poorly. The new route is ~40 lines.

---

## 5. Presentation — tabbed detail modal

The detail modal (`training-detail-modal.tsx`, reused by Run History against
archived snapshots) is already tall with the loss graph; samples get their own
tab rather than another stacked section.

- **Tabs**: `Overview | Samples` via `SegmentedControl` in the modal header —
  the exact pattern the model-manager modal uses
  (`model-manager-modal.tsx:35`). Tab state lives in the modal wrapper;
  `TrainingDetailContent` stays the Overview body. The Samples tab is hidden
  entirely when the run has no samples (sampling disabled, or none arrived
  yet — show it once the first image lands).
- **Width**: bump the modal to `max-w-5xl` so a 3–4 prompt grid breathes.
  Mobile stays best-effort (this is content-dense desktop territory): the
  grid sits in an `overflow-x-auto` container so narrow viewports scroll
  horizontally rather than crush the columns. Anything fancier is low-prio
  polish, not part of this work.

### The grid

Columns = prompts, rows = sampling events:

```
             p0: "woman, red hair…"   p1: "man in a suit…"   p2: "landscape…"
step 750     [img]                    [img]                  [img]
step 500     [img]                    [img]                  [img]
step 250     [img]                    [img]                  [img]
```

- Column headers: truncated prompt text (full text on hover/lightbox).
- Row labels: step, plus epoch when the run is epoch-driven.
- Newest row first for live runs — the fresh row appears at the top as the
  status stream delivers it (no new polling; it rides the existing WS).
- Scan down a column to watch one prompt converge; across a row to compare
  prompts at a moment in time.

### Lightbox — in-place, not a second modal

Clicking a thumbnail swaps the tab body (or overlays `absolute inset-0`
within the modal) to a single large image — a *modality within the space*,
no modal-over-modal:

- Meta bar: step/epoch stamp, full prompt text.
- **Up/Down** (or click row stamps): same prompt across steps — the "is it
  improving?" axis, the reason you opened it.
- **Left/Right**: across prompts at the same step.
- **Esc**: closes the lightbox first, the modal second (one
  `stopPropagation`-style guard in the key handler).

---

## 6. Implementation phases (each shippable alone)

1. **Sidecar collection** — structured `samples` in both providers via
   scan-diff; delete the dead log parse; relative paths. Types mirrored in
   the client. Includes the epochs-cadence wiring (decision 1) since it
   touches the same request-builder/provider surface.
2. **Serving + live UI** — the samples route; tabbed modal with grid and
   lightbox; live runs only (history entries show whatever paths still
   resolve).
3. **Archive + retention** — terminal-time move, history wiring, deletion on
   history delete.

---

## 7. Decisions (settled 2026-07-24)

| # | Question | Decision |
|---|----------|----------|
| 1 | Epochs cadence toggle | **Wire it** — dual-field like save cadence; Kohya gets `--sample_every_n_epochs` natively, ai-toolkit fakes epochs via steps conversion as training duration already does (§1) |
| 2 | Archive: move at terminal vs leave in place | **Move** (§3) |
| 3 | Orphaned archive folders after browser-storage loss | **Ignore** — hard to solve properly, user can tidy manually; sidecar-side history later makes it moot |
| 4 | Modal width | **Widen whole modal** to `max-w-5xl`; mobile best-effort via horizontal scroll on the grid (§5) |

## 8. Out of scope (noted for later)

- Per-prompt overrides (negative prompt, seed, size) — both backends support
  rich per-sample config (Kohya inline `--n/--d/--w/--h` flags, ai-toolkit
  per-sample fields); the form stays simple for now.
- Video samples (Wan/LTX produce frame sequences / videos via `num_frames`) —
  grid assumes still images; revisit with the video milestone.
- Thumbnail generation / disk-space caps for the archive.
- Sample-vs-loss correlation (marking sample events on the loss chart's
  x-axis would be a cute later touch).
