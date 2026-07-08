/**
 * Middleware for the jobs slice:
 * - Persists download jobs to localStorage on every change
 * - Auto-opens the activity panel when a new job is added
 * - Mirrors model-manager status changes into the auto-tagger slice so
 *   both surfaces stay in sync (the Model Manager modal owns the
 *   model-manager slice; the tagging UI reads the auto-tagger slice).
 */

import { createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit';

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
} from '../jobs';
import { persistDownloadJobs } from '../jobs/persistence';
import { setModelStatus } from '../model-manager';
import { recordTrainingRun } from '../training-history';
import { persistTrainingHistory } from '../training-history/persistence';

/** Statuses at which a training run is finished and worth archiving. */
const TERMINAL_TRAINING_STATUSES = new Set(['completed', 'failed', 'cancelled']);

export const jobPersistenceMiddleware = createListenerMiddleware();

// High-frequency / UI-only jobs actions that never change what actually gets
// persisted (all downloads + *terminal* training runs). Progress ticks fire
// many times a second during active work, tagging jobs aren't persisted at all,
// and panel toggles are pure UI state — so serialising + writing localStorage on
// them is wasted work. Everything else still persists (fail-safe denylist: a
// future job-mutating action persists by default).
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
// slice no longer writes its own `img-tagger:training-jobs` copy).
jobPersistenceMiddleware.startListening({
  predicate: (action) =>
    typeof action.type === 'string' &&
    action.type.startsWith('jobs/') &&
    !NON_PERSISTING_JOB_ACTIONS.has(action.type),
  effect: (_action, listenerApi) => {
    const state = listenerApi.getState() as RootState;
    persistDownloadJobs(state.jobs.jobs);

    // Archive terminal training runs into the history slice. Idempotent: skip
    // any run already recorded with the same terminal status + completion time,
    // so live progress ticks on running jobs (the common case) do no work.
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
      listenerApi.dispatch(recordTrainingRun(job));
    }
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
