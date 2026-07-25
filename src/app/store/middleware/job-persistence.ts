/**
 * Middleware for the jobs slice:
 * - Persists download jobs to localStorage on every change
 * - Auto-opens the activity panel when a new job is added
 * - Mirrors model-manager status changes into the auto-tagger slice so
 *   both surfaces stay in sync (the Model Manager modal owns the
 *   model-manager slice; the tagging UI reads the auto-tagger slice).
 */

import { createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit';

import type { SampleImage } from '@/app/services/training/types';

import { updateModelStatus as updateAutoTaggerModelStatus } from '../auto-tagger';
import type { RootState } from '../index';
import {
  addJob,
  closePanel,
  openPanel,
  togglePanel,
  updateDownloadProgress,
  updateTaggingProgress,
  updateTrainingProgress,
  updateTrainingSamples,
} from '../jobs';
import { persistDownloadJobs } from '../jobs/persistence';
import type { TrainingJob } from '../jobs/types';
import { setModelStatus } from '../model-manager';
import {
  clearHistory,
  deleteHistoryEntry,
  recordTrainingRun,
  updateEntrySamples,
} from '../training-history';
import { persistTrainingHistory } from '../training-history/persistence';

/** Statuses at which a training run is finished and worth archiving. */
const TERMINAL_TRAINING_STATUSES = new Set([
  'completed',
  'failed',
  'cancelled',
]);

export const jobPersistenceMiddleware = createListenerMiddleware();

/**
 * Move a terminal run's training samples into its per-run archive, then repoint
 * both the history entry and the live job at the archived paths so nothing
 * references the moved files.
 *
 * Fire-and-forget: the history record must NOT wait on this. Any failure (fs
 * error / route 500 / offline) leaves the original paths in place — the grid
 * then shows whatever still resolves, the doc's stated fallback. An empty
 * response means nothing moved (e.g. a second archive of an already-moved run,
 * whose sources are all gone → all skipped), so paths are left untouched rather
 * than wiped.
 */
function archiveJobSamples(
  job: TrainingJob,
  dispatch: (action: unknown) => unknown,
) {
  const samples = job.progress?.samples;
  if (!samples || samples.length === 0) return;

  void fetch('/api/training/samples/archive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: job.id, samples }),
  })
    .then((res) =>
      res.ok
        ? (res.json() as Promise<{
            samples?: SampleImage[];
          }>)
        : null,
    )
    .then((data) => {
      const archived = data?.samples;
      if (!archived || archived.length === 0) return; // nothing moved → keep paths
      dispatch(updateEntrySamples({ id: job.id, samples: archived }));
      dispatch(updateTrainingSamples({ id: job.id, samples: archived }));
    })
    .catch(() => {
      // Leave the original paths; the grid falls back to whatever resolves.
    });
}

/** Fire-and-forget delete of a run's archived sample folder. 404/failure ok. */
function deleteArchivedSamples(jobId: string) {
  void fetch(`/api/training/samples/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
  }).catch(() => {
    // Nonexistent folder / offline — deletion is best-effort.
  });
}

/**
 * Snapshot any training job that has reached a terminal state into the durable
 * history archive. Idempotent: skips a run already recorded with the same
 * terminal status + completion time, so repeat calls (and live progress ticks)
 * do no work. Safe to call from any listener.
 */
function archiveTerminalTrainingRuns(
  state: RootState,
  dispatch: (action: unknown) => unknown,
) {
  const history = state.trainingHistory.entries;
  for (const job of Object.values(state.jobs.jobs)) {
    if (job.type !== 'training') continue;
    if (!TERMINAL_TRAINING_STATUSES.has(job.status)) continue;
    const existing = history[job.id];
    if (
      existing &&
      existing.status === job.status &&
      existing.completedAt === job.completedAt
    ) {
      continue;
    }
    dispatch(recordTrainingRun(job));
    // Fire the archive move in the same branch that first records the run to
    // history, so it runs exactly once per terminal transition (the guard
    // above short-circuits every later call). A second archive of the same run
    // is harmless anyway: the route returns already-archived entries as-is,
    // so re-dispatching them changes nothing.
    archiveJobSamples(job, dispatch);
  }
}

// High-frequency / UI-only jobs actions that never change what actually gets
// persisted (all downloads + *terminal* training runs). Progress ticks fire
// many times a second during active work, tagging jobs aren't persisted at all,
// and panel toggles are pure UI state — so serialising + writing localStorage on
// them is wasted work. Everything else still persists (fail-safe denylist: a
// future job-mutating action persists by default).
//
// NOTE: `updateTrainingProgress` is excluded here to avoid serialising on every
// tick, but a training run reaches its terminal status *through* this same
// action (the sidecar broadcasts the final completed/failed/cancelled progress
// over the WebSocket). Archiving is therefore handled by its own dedicated
// listener below, which short-circuits on non-terminal ticks — without it,
// terminal runs would never be recorded to history.
const NON_PERSISTING_JOB_ACTIONS = new Set<string>([
  updateTrainingProgress.type,
  updateDownloadProgress.type,
  updateTaggingProgress.type,
  openPanel.type,
  closePanel.type,
  togglePanel.type,
]);

// Persist download jobs to localStorage on meaningful jobs/ actions, and
// snapshot any newly-terminal training run into the durable history archive —
// which is the single persisted home for terminal training runs (the jobs
// slice no longer writes its own `img-tagger:training-jobs` copy). This covers
// terminal transitions that arrive via a non-excluded action (e.g. a manual
// `updateJobStatus`); the WebSocket-driven common case is handled below.
jobPersistenceMiddleware.startListening({
  predicate: (action) =>
    typeof action.type === 'string' &&
    action.type.startsWith('jobs/') &&
    !NON_PERSISTING_JOB_ACTIONS.has(action.type),
  effect: (_action, listenerApi) => {
    const state = listenerApi.getState() as RootState;
    persistDownloadJobs(state.jobs.jobs);
    archiveTerminalTrainingRuns(state, listenerApi.dispatch);
  },
});

// Archive a training run the moment its streamed progress goes terminal.
// `updateTrainingProgress` fires many times a second, so we short-circuit on
// non-terminal ticks (the common case does no work) — but we must listen for
// it, because completed/failed/cancelled status only ever arrives on this
// action, and it's deliberately absent from the download-persistence path above.
jobPersistenceMiddleware.startListening({
  actionCreator: updateTrainingProgress,
  effect: (action, listenerApi) => {
    if (!TERMINAL_TRAINING_STATUSES.has(action.payload.progress.status)) return;
    archiveTerminalTrainingRuns(
      listenerApi.getState() as RootState,
      listenerApi.dispatch,
    );
  },
});

// Persist the history archive whenever it changes.
jobPersistenceMiddleware.startListening({
  predicate: (action) =>
    typeof action.type === 'string' &&
    action.type.startsWith('trainingHistory/'),
  effect: (_action, listenerApi) => {
    const state = listenerApi.getState() as RootState;
    persistTrainingHistory(state.trainingHistory.entries);
  },
});

// Auto-open the activity panel when a new job is added
jobPersistenceMiddleware.startListening({
  matcher: isAnyOf(addJob),
  effect: (_action, listenerApi) => {
    listenerApi.dispatch(openPanel());
  },
});

// Delete a run's archived sample folder when the run actually leaves Run
// History — a single delete or a full clear. Fire-and-forget: a 404 / fs error
// is fine (the folder is already gone or can be swept by hand). NB: the
// activity panel's "Clear all" dispatches dismissAllFromPanel/dismissFromPanel,
// which are deliberately NOT matched here — dismissing keeps the files.
jobPersistenceMiddleware.startListening({
  matcher: isAnyOf(deleteHistoryEntry, clearHistory),
  effect: (action, listenerApi) => {
    if (clearHistory.match(action)) {
      // Capture ids from the pre-reducer state: by the time this effect runs
      // the reducer has already emptied the archive.
      const prev = listenerApi.getOriginalState() as RootState;
      for (const id of Object.keys(prev.trainingHistory.entries)) {
        deleteArchivedSamples(id);
      }
    } else if (deleteHistoryEntry.match(action)) {
      deleteArchivedSamples(action.payload);
    }
  },
});

// Mirror model-manager status changes into the auto-tagger slice.
// The auto-tagger reducer's updateModelStatus is a no-op when the model
// isn't in its list, so this is safe to dispatch unconditionally.
jobPersistenceMiddleware.startListening({
  actionCreator: setModelStatus,
  effect: (action, listenerApi) => {
    const { modelId, status } = action.payload;
    listenerApi.dispatch(updateAutoTaggerModelStatus({ modelId, status }));
  },
});
