# Tagging + Sidecar Reliability Review — 2026-07-30

Scope: reliability of tagging job runs, history, and UI↔sidecar synchronisation.
Four parallel sweeps (sidecar captioning lifecycle, UI services + API routes,
tagging store/attach flows, and the post-e8bd030 history plumbing), with every
P1 and most P2s re-verified against the working tree by hand. Findings from the
2026-07-28 tagging review that were already fixed in `f73a8fe` are not repeated;
its deferred P3 backlog is not repeated either.

Severity: **P1** = data loss or a wedge that needs a process restart ·
**P2** = reliability gap with a realistic trigger · **P3** = tightening.

## Fix status (2026-07-30, same session)

**Fixed:** all six P1s, plus P2s 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.10, 2.11,
2.12, 2.13, 2.14, 2.15, the P3 registry-clobber guard, and the P3 terminal-
reducer `completedAt` restamp (jobs slice, failed/cancelled branches). Verified
with `tsc --noEmit`, ESLint over changed files, a production build, and
`py_compile` (+ live behavioural tests in the sidecar venv: fake-streamer
generate-crash/cancel timing, JobRegistry collision, JobManager recovery
against a temp dir, clear_batch outcome matrix).

Notable shapes chosen during the fixes:
- Sidecar clear endpoint now distinguishes 404 (unknown id — stop polling)
  from 409 (still active — keep polling); the whole cancel→clear contract is
  delivery-checked end to end.
- Staged results are deduped by `fileId` (replay is idempotent by
  construction) instead of wiped before reattach.
- The assets slice records `loadedProject`; flushes refuse to apply against a
  different project and keep everything staged.
- Per-job state in `use-auto-tagger` is keyed by job id (`Map`s + per-job
  AbortSignal), so concurrent batches finalise independently.
- Streamer consumption polls at 0.5s so cancel and the join timeout are
  reachable even when `generate` emits nothing (prefill hang); a generation
  thread that outlives its join pins the model against load/unload.

**Deferred (unchanged):** 2.2 + 2.9 (caption-batch persistence and tagging
history — architecture work), 2.8 (staged-copy-until-save), 2.16 (multi-tab),
and the remaining P3s (terminal-batch TTL, watchdog unclaimed-results gate,
create_task reference, stderr swap, provider-type stamp on reattach summaries,
`/tag` route abort/cap, HMR split-brain note).

Verification status is marked per finding: **[confirmed]** = re-read the cited
code in this session; **[plausible]** = reviewer-reported, consistent with
confirmed neighbouring code, not independently re-traced.

---

## Recurring themes (read this first)

1. **Best-effort calls that report success.** `clearCaptionBatch`,
   `cancelCaptionBatch`, `/api/training/clear`, and the batch clear route all
   swallow failure or ignore response status, then their callers act on the
   fake success. Every resurrection bug below (1.2, 2.4, 2.13) is this shape.
2. **Error paths destroy the durable copy.** The localStorage staging store is
   the *only* surviving copy of results once the sidecar copy dies, yet three
   error paths clear it instead of flushing it (1.4).
3. **Single-slot session state for a multi-batch world.** `currentJobIdRef`,
   `imageErrorsRef`, `adoptedBatchIds`, and `batches[0]` all assume one batch
   per tab per lifetime; the sidecar queue and cross-project navigation break
   that assumption (1.6, 2.7, 2.16).
4. **Caption batches are second-class citizens vs training jobs.** Training
   runs get disk persistence, crash recovery, interrupted-run marking, and
   durable history. Caption batches get in-memory state, no restart record,
   and no history at all (2.2, 2.9).

---

## P1 — Data loss / permanent wedges

### 1.1 Exception inside `model.generate` hangs the batch and wedges the GPU queue forever **[confirmed]**
`training-sidecar/captioning/transformers_provider.py:445-487` (image),
`:667-702` (video)
`TextIteratorStreamer` is constructed without a `timeout`, and the generation
thread target is a bare `self._model.generate` with no exception wrapper. If
`generate` raises (CUDA OOM is the realistic case — see the known 16GB
sysmem-fallback behaviour), `streamer.end()` never fires and
`for chunk in streamer` blocks forever on the internal queue. `cancel_check`
is only polled per chunk, so cancel cannot rescue it — the cancel drain loop
(`:484-486`) blocks on the same dead queue. The batch stays `running` in both
`BatchState` and the registry, the single queue worker never returns, every
subsequent training job and caption batch queues behind it forever, and the
idle watchdog (`main.py:82`) can never fire. Manual process kill is the only
recovery. **Fix:** wrap the thread target to capture the exception and call
`streamer.end()` in a `finally`; re-raise the captured exception in the
consumer (or construct the streamer with a `timeout` and handle `Empty`).

### 1.2 Cancelled VLM batches are never cleared — they resurrect after refresh and re-apply stale results **[confirmed]**
`src/app/api/auto-tagger/batch/clear/route.ts:28-32` +
`src/app/services/auto-tagger/providers/vlm/client.ts:603-613` +
`src/app/services/auto-tagger/tagging-controllers.ts:74-88` +
`training-sidecar/main.py:503-513`
Found independently by two sweeps. `cancelTaggingJob`'s poll loop is built on
the contract "the clear route 409s until the batch goes terminal"
(`tagging-controllers.ts:72-73`) — but that contract only holds for ONNX.
For a VLM batch, `clearOnnxBatch(unknownId)` returns `true` (unknown id =
no-op), then `clearCaptionBatch` fires a fetch and never inspects the
response — the sidecar's 409 (`main.py:511`, batch still queued/running) does
not reject `fetch`, so the route answers 200 `'cleared'`. The poll loop exits
on its first tick believing the batch is gone; the sidecar keeps the terminal
cancelled batch (and its partial results) forever. `adoptedBatchIds` is
per-tab in-memory state (`tagging-controllers.ts:18`), so after any refresh
the reattach sweep re-adopts the batch: a phantom job appears and the partial
captions are re-applied via `setCaptionText`, silently overwriting any edits
made since the cancel — on every refresh until the sidecar restarts.
**Fix:** make `clearCaptionBatch` return the sidecar's status and have the
route surface 409; better, also clear terminal batches sidecar-side once
collected (or on cancel completion).

### 1.3 WebSocket close race permanently hangs a batch stream — job immortal in "running" **[confirmed]**
`src/app/services/auto-tagger/providers/vlm/client.ts:245-305`
The `close`/`error` handlers only settle a *currently pending* `next()`
(`resolveNext`); nothing records that the socket closed — no closed flag, no
null sentinel pushed to `queue`. If close fires while the consumer is
processing a buffered event (message + close delivered in one macrotask is
enough), the close signal is lost and the consumer's next `next()` call waits
forever. `consumeSocket`'s "null means closed" contract (`:321-328`) only
holds if the consumer happened to be awaiting at close time. The SSE stream in
the batch/attach routes never ends, and the UI job shows `running`
indefinitely — the exact "batch dead on sidecar, UI unaware" case. **Fix:**
set a `closed` flag and push a null sentinel into the queue on close/error;
`next()` returns null when the queue is drained and `closed` is set.

### 1.4 Batch-level errors destroy all staged partial results — a failed batch's good results are unrecoverable by any path **[confirmed]**
`src/app/tagging/components/auto-tagger/use-auto-tagger.ts:1079` (live path),
`:652-661` (reattach error path), `:532` (pre-attach clear) **[:532/:660
plausible, :1079 confirmed]**
The live error branch calls `clearPendingTagResults` — wiping every per-image
result staged in localStorage during the run — while the `!receivedComplete`
branch directly above it (`:1056-1059`) *flushes* partials in the equivalent
situation. Sidecar crashes at image 90/100: the WS close throws (via 1.3's
fixed path or a clean close), the route emits `error`, the client throws at
the error event, and 90 good captions are deleted; the sidecar copy died with
the crash. The reattach path has the same hole twice: `reattachToBatch` clears
the localStorage backup *before* the attach fetch is known to succeed, and
attaching to a `failed` batch replays all its good results then hits the
terminal-failed throw, which clears them again. Net: there is no path by which
a failed batch's partial results can ever be collected. **Fix:** flush (not
clear) on batch-level error, matching the `!receivedComplete` branch; don't
clear the backup until the replacement stream has delivered.

### 1.5 Cross-project contamination: a batch's results can be applied to the wrong project's images **[confirmed]**
`src/app/store/assets/flush-pending-tags.ts:32-36` +
`use-auto-tagger.ts:452` (flush call from the navigation-surviving SSE loop)
`flushPendingTagResults(projectA)` reads project A's staged results but
validates each one only by `imageIndexById[result.fileId]` against whatever
assets are **currently loaded** — there is no check that the loaded project is
A. `fileId` is the project-relative path minus extension, so collisions across
projects (`001`, `img_0001`, …) are routine in curated datasets. The SSE loop
deliberately survives navigation (`use-auto-tagger.ts:383-388`), so: start a
caption batch in A, browse to B, batch completes → `flushAndFinalise('A', …)`
runs against B's store → colliding ids get A's captions/tags applied to B's
images and marked dirty; a save writes A's caption into B's `.txt`. The
results are simultaneously *removed* from A's pending store, so A never
receives them. The deselect at `:455-462` has the same collision hazard.
**Fix:** store the loaded project's folder name in the assets slice and bail
(keep results pending) when it doesn't match the flush's project argument.

### 1.6 Starting a second batch wedges the first job in `running` forever and cross-contaminates its summary **[confirmed]**
`use-auto-tagger.ts:176-179` (single-slot `currentJobIdRef`/`imageErrorsRef`),
`:425-427` (summary built from shared ref), `:476` (settle-window guard)
The hook instance survives `/tagging/A/1 → /tagging/B/1` navigation, and
cross-project concurrency is real (the sidecar queues batches). Start batch A,
navigate to B, start batch B: both refs now belong to B while A's stream is
still live. When A's `complete` arrives, its summary is built from
`imageErrorsRef` (B's errors), and after the 350ms settle delay the guard
`currentJobIdRef.current !== jobId` fires → `completeTagging` is never
dispatched. Job A is stuck `running` for the session:
`selectActiveTaggingJob(A)` stays truthy, A's auto-tagger modal permanently
redirects to a dead detail view (`:396-400`), and A's reattach sweep is
suppressed. **Fix:** key the refs by job id (a Map), and make the settle guard
check job-specific cancellation rather than global ref identity.

---

## P2 — Reliability gaps

### 2.1 Run History is empty for the whole session when the app opens with the sidecar down **[confirmed]**
`src/app/api/training/jobs/route.ts:17-24` +
`src/app/store/training/training-runtime.ts:960-995` +
`src/app/shared/activity-panel/activity-panel.tsx` (once-per-mount ref)
The jobs route answers `{jobs: []}` with HTTP 200 when the sidecar is
unreachable — indistinguishable from "no history" — and `hydrateTrainingHistory`
fires once per mount with no retry (unlike `hydrateActiveTraining`'s retry
ladder). The sidecar only spawns on demand and idle-exits ~2min after Node's
heartbeat stops, so the common cold-start case is: open app → Run History and
terminal cards empty despite full records on disk; launching a run spawns the
sidecar but history is never re-fetched. **Fix:** include `sidecar_status` in
the empty answer (it's already there), and re-run the hydrate when the sidecar
transitions to ready (or on Run History modal open).

### 2.2 Caption batch state is purely in-memory; a sidecar restart destroys mid-batch results with no record **[confirmed]**
`training-sidecar/captioning/batch_manager.py:53` vs
`job_manager.py:842-891` (training jobs persisted + recovered as FAILED)
Sidecar restart (manual button, crash, self-heal) at image 400/500: on
restart `/caption/batches` is empty and the batch id 404s — indistinguishable
from "cleared". No `failed` event is ever broadcast (worker-task
`CancelledError` at shutdown escapes `except Exception` and leaves the state
`running`), and the accumulated results the UI hadn't flushed are gone.
Training jobs get an explicit "interrupted — sidecar restarted" record;
caption batches get nothing. Mitigated for *attached* clients by the
localStorage staging copy — but 1.4 wipes that on the resulting error. **Fix
shape:** persist per-batch progress the way training jobs are persisted, or at
minimum recover-and-mark-failed so reattach gets a truthful terminal state.

### 2.3 Sidecar job persistence is truncate-then-write; a crash corrupts the run's only durable record, which is then orphaned **[confirmed]**
`training-sidecar/job_manager.py:827-840` (`path.write_text`),
`:859-891` (recovery skips corrupt files with a warning)
The file is rewritten every ~5s for the life of a multi-hour run. A hard kill
/ power loss mid-write truncates it; recovery catches `JSONDecodeError`,
warns, and moves on — the run vanishes from `/jobs` and history entirely, and
the corrupt file is orphaned forever (`delete_job` requires the id to be in
`self._jobs`, which a failed parse never reaches). **Fix:** write to
`<id>.json.tmp` + `os.replace`; quarantine (rename) unparseable files during
recovery so they're visible and sweepable.

### 2.4 Cancel is fire-and-forget with fake success — a cancel that never lands re-applies the full run later **[confirmed]**
`vlm/client.ts:587-597` + `api/auto-tagger/batch/cancel/route.ts`
`cancelCaptionBatch` silently returns when the sidecar is mid-restart,
swallows fetch failures, never checks status; the route answers 200
`{status:'cancelling'}` unconditionally. The UI marks the job cancelled and
adopted; the batch runs to completion sidecar-side; after a refresh the sweep
re-adopts it and applies the full results — silently overriding an explicit
cancel. **Fix:** surface cancel delivery failure (retry or mark the job
"cancel failed — still running").

### 2.5 Failed ONNX batches are never cleared and re-fail on every refresh **[plausible]**
`wd14/batch-store.ts` (failed batches persist; attach replays then throws) +
`use-auto-tagger.ts:652-661` (error path never clears)
`flushAndFinalise` (which issues the clear) is only reached on
complete/cancelled. A failed ONNX batch stays in the module map; every refresh
the sweep adopts it, attach replays + throws, a fresh red "failed" job
appears, and the replayed results are wiped (1.4). Loops until the Next server
restarts. **Fix:** clear terminal-failed batches after the error path records
the failure (once 1.4 makes that path flush first).

### 2.6 Single-shot adoption: a transient attach failure permanently orphans a running batch **[confirmed against the cited lines]**
`use-auto-tagger.ts:704-706`
`markBatchAdopted` runs *before* `reattachToBatch`, and nothing retries.
A dev-server recompile or transient 500 during the attach fetch → job marked
failed, batch keeps running sidecar-side, sweep never retries this session.
(Already flagged as a P3 footnote in the 2026-07-28 review; upgraded here
because the batch/clear contract bugs make orphaned batches common.)
**Fix:** only mark adopted once the attach stream delivers its first event;
un-mark on attach failure.

### 2.7 Reattach sweep only considers `batches[0]` **[plausible]**
`use-auto-tagger.ts:702-706`
If the first listed batch was already adopted (or is a stuck terminal one from
1.2/2.5), the sweep returns without trying the rest — a second completed
batch's results are never collected this session. **Fix:** iterate the list,
skip adopted, attach the first eligible.

### 2.8 On completion, every durable copy of the results is destroyed while they exist only as unsaved Redux state **[confirmed by design-reading]**
`use-auto-tagger.ts:443-452` (fires `/batch/clear` then flushes) +
`flush-pending-tags.ts:68` (clears localStorage) — tags land as `TO_ADD`,
captions as dirty text, with no autosave. A tab crash or refresh between
flush and manual save loses the entire run: sidecar copy cleared, localStorage
cleared. **Fix:** keep the staged copy until the user's save succeeds (clear
it from the save path), or defer `/batch/clear` until save.

### 2.9 Tagging batches have no history at all **[confirmed by omission]**
`store/middleware/job-persistence.ts:150-157` ("tagging jobs aren't persisted
at all") + activity-panel restore paths (training + downloads only)
A terminal tagging batch's card, summary, and per-image error list — the only
record of which images were skipped — vanish on refresh. 500-image overnight
batch with 40 per-image errors + morning F5 = no evidence it ran. Given
training runs now have sidecar-side durable history, captioning parity is the
obvious shape (the sidecar already holds the batch record; it just gets
cleared instead of archived). **Fix shape:** persist terminal batch summaries
(sidecar-side like training runs, or the old localStorage pattern) and render
them in the panel/history view.

### 2.10 Cancel cannot interrupt model loading; the `CaptionCancelled` handler around `prepare()` is dead code **[plausible]**
`batch_manager.py:236-242` + `transformers_provider.py:713-723` +
`llama_cpp_provider.py:242-249`
`prepare()` receives no `cancel_check` and neither provider raises
`CaptionCancelled` during load, so a cancel during a multi-GB model load waits
for the full load; if the load itself hangs (`from_pretrained` on an
unreachable path has no timeout), the batch is stuck `running` with the queue
blocked — same end-state as 1.1. **Fix:** poll `cancel_check` between load
stages; consider a load timeout.

### 2.11 Cancel during generation silently blocks until the full token budget completes; the 60s join timeout is never checked **[confirmed]**
`transformers_provider.py:484-487`, `:699-702`
The cancel path drains the streamer, which only ends when `generate` finishes
all remaining tokens — on a sysmem-fallback run that's minutes, during which
the batch shows `running` with no progress (module docstring promises
<100ms). `gen_thread.join(timeout=60)`'s expiry is untested: a truly stuck
generate leaks an orphaned thread still running a forward pass on
`self._model` while `unload()`/the next load can `del` it out from under —
a use-after-free-shaped race. **Fix:** check `is_alive()` after the join and
refuse to unload/reload while an orphan holds the model; use a stopping
criterion (`StoppingCriteria` polling `cancel_check`) so generate itself
aborts within a step.

### 2.12 `hydrateActiveTraining` builds lossy skeleton records that can win the race against full history hydration **[plausible]**
`training-runtime.ts:867-875` (discards `client_config`/`project`/
`form_snapshot`/`completed_at` although `/api/training/status` returns them)
Refresh during a run → session job has skeleton config; that skeleton is what
gets archived on terminal and what the project menu's recent-runs filter
misses. When nothing is running, the status route's focus-job answer can seed
a skeleton *terminal* record that `restoreHistory` then refuses to overwrite —
degraded record sticks for the session. **Fix:** build the record via
`trainingJobFromSidecar` from the full payload (it's already returned).

### 2.13 Deleting a run from Run History while its card is still in the panel resurrects it **[confirmed]**
`training-history-modal.tsx:181,188` (dispatches only
`deleteHistoryEntry`/`clearHistory`, never `removeJob`) +
`job-persistence.ts:111-135` (re-archives any terminal job absent from
history on every non-denylisted `jobs/` action)
Delete fires `deleteRunArtifacts` (sidecar record + files gone), then the next
`jobs/` action re-records the still-present panel job into history and
`archiveJobSamples` re-fires against the just-deleted files — a zombie entry
with dead sample paths, surviving until reload. **Fix:** have the delete path
also `removeJob` (and dismiss sidecar-side if still present).

### 2.14 Terminal-run `completedAt` restamped to "now" on reconnect **[plausible]**
`training-runtime.ts:451-458` — `resyncJobs` applies a terminal sidecar entry
via `buildProgress`, which stamps `Date.now()` instead of using the entry's
`completed_at` (which `trainingJobFromSidecar` uses correctly). Overnight
disconnect → duration inflated by hours in history. **Fix:** thread
`entry.completed_at` through.

### 2.15 Cancel-with-dead-socket and dismiss failures resurrect cards **[plausible]**
`training-runtime.ts:790-808` (`cancelTraining` removes locally but never
dismisses sidecar-side when `!ws.socket`) and `:825-831` +
`api/training/clear/route.ts:19-22` (dismiss swallowed / success-shaped noop
when sidecar unreachable). Both leave `dismissed: false` on the sidecar, so
the next hydrate/resync seeds the "removed" card straight back. **Fix:**
route both through a delivery-checked dismiss (retry or queue until sidecar
ready).

### 2.16 Multi-tab: per-tab adoption + shared localStorage key → double-attach, lost updates, double-apply **[plausible]**
`tagging-controllers.ts:18` + `pending-tag-results.ts:22-36` (non-atomic
read-modify-write) — two tabs on one project both adopt the same batch (the
sidecar broadcasts to all WS clients), interleaved writes drop entries,
summaries double-count, both tabs flush and clear. **Fix:** move adoption to
a shared medium (localStorage lock/BroadcastChannel) or make the staging store
append-only per tab.

---

## P3 — Tightening

- **`JobRegistry.create` blindly overwrites an existing record**
  (`job_registry.py:91-110`) — a colliding client-supplied batch id resets a
  running job's record to QUEUED; `has_running()` goes false → watchdog can
  shut down mid-run. **[confirmed]** Guard on existing id.
- **Terminal caption batches + full results retained indefinitely**
  (`batch_manager.py:377-386`) — no TTL/cap; unclaimed batches accumulate for
  the sidecar's lifetime. **[confirmed]**
- **Idle watchdog can exit with unclaimed completed results**
  (`main.py:73-100`) — gate is running/queued only; a completed batch whose
  client died counts as "nothing to do", destroying the in-memory results the
  reattach flow was promised (`batch_manager.py:79-81` comment). **[confirmed]**
- **Terminal tagging reducers lack the terminal-status guard the progress
  reducers have** (`store/jobs/index.ts:230-260` vs `:203`) — cancel racing an
  already-parsed `complete` can flip terminal states. **[plausible]**
- **Stale pending results never expire and are keyed by bare file id**
  (`flush-pending-tags.ts:42-45`) — a deleted image's result waits forever; a
  later image with the same name silently inherits months-old tags.
  **[plausible]** Add a staged-at timestamp + TTL, and drop `remaining`
  entries older than it.
- **Fire-and-forget `loop.create_task` without a reference**
  (`batch_manager.py:108`) — queue-position broadcast can be GC'd; retain in a
  set. **[plausible]**
- **Process-wide `sys.stderr` swap during model load isn't reentrant**
  (`transformers_provider.py:302-321`) — benign single-worker; breaks the day
  a second worker/multi-GPU lands. **[plausible]**
- **Reattached-batch summary stamps the currently-selected provider, not the
  batch's** (`use-auto-tagger.ts:427`) — wrong data persisted in the summary.
  **[plausible]**
- **`/api/auto-tagger/tag` ignores `request.signal` and caps nothing** — a
  disconnected client's large request occupies the serialised worker queue to
  completion. **[plausible]**
- **Dev-only: HMR splits the ONNX worker/batch-store module state** — mid-run
  recompile makes the batch invisible/uncancellable and leaks the old worker.
  Known restart-drops-state is documented; the split-brain isn't. **[plausible]**
- **Migration note:** e8bd030 removed the localStorage history reader without
  a migration; every run finished before 2026-07-29 exists only in the
  now-orphaned `img-tagger:training-history` key (the old sidecar swept its
  job files on restart). If any of that history matters, a one-off import is
  still possible while the key survives in the browser profile. **[plausible]**

---

## Verified sound (checked, not vibes)

- Per-image caption failures don't kill the batch; they're recorded and
  broadcast (`batch_manager.py:296-321`).
- Cancel-vs-dequeue on the sidecar event loop has no interleaving window;
  provider load failure fails the batch cleanly and releases the queue.
- Job-finishes-with-no-UI-open is safe for **training**: the sidecar persists
  terminal state immediately, bypassing the 5s throttle.
- Stale "running" training entries are flipped to FAILED on sidecar restart
  and picked up by `resyncJobs`; the resync-vs-live-WS race is guarded by a
  fresh terminal check.
- ONNX worker crash recovery (exit-before-ready and mid-request) rejects and
  respawns correctly — the 2026-07-28 P1.1 fix holds.
- Snapshot/live dedup via `seenItems` prevents double-yield on both providers;
  ONNX double-submit is 409-guarded (P1.9 fix holds).
- Tagging surfaces have no SSR hydration exposure (jobs slice starts empty;
  all stamps happen post-mount).
