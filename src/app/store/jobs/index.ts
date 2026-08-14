/**
 * Unified jobs slice.
 *
 * Tracks all long-running operations: training runs, model downloads,
 * and future generation jobs. The activity panel reads from this slice.
 *
 * Nothing here is persisted client-side, deliberately. Every long-running job
 * is owned by the Python sidecar, which keeps its own durable record —
 * `<training>/jobs/<job_id>.json` for training runs, `<training>/downloads/
 * <job_id>.json` for downloads — and this slice is a projection of those,
 * rebuilt on mount by `hydrateTrainingHistory`, `hydrateActiveTraining` and
 * `hydrateDownloads`.
 *
 * Downloads used to be mirrored into localStorage, back when the transfer
 * itself ran in the Next.js route and died with the browser connection: a
 * saved copy was the only way a refresh remembered anything. Now the sidecar
 * keeps downloading through the refresh, so a second copy could only go stale
 * and contradict it.
 */

import {
  createSelector,
  createSlice,
  type PayloadAction,
} from '@reduxjs/toolkit';

import type {
  SampleImage,
  TrainingProgress,
} from '@/app/services/training/types';

import type { RootState } from '../index';
import type {
  DownloadJob,
  Job,
  JobsState,
  JobStatus,
  TaggingImageError,
  TaggingJob,
  TaggingProgress,
  TaggingResult,
  TaggingSummary,
  TrainingJob,
} from './types';

const initialState: JobsState = {
  jobs: {},
  panelOpen: false,
  detailJob: null,
};

/**
 * Whether a job has reached a state it can never legitimately leave. Progress
 * reducers use this to drop late-arriving ticks: the SSE loop has await points
 * during which a user cancel can land, and without the guard the next progress
 * dispatch would flip the job back to `running` with nothing left to ever
 * finalise it.
 */
const isTerminalStatus = (status: JobStatus): boolean =>
  status === 'completed' ||
  status === 'failed' ||
  status === 'cancelled' ||
  status === 'interrupted';

const jobsSlice = createSlice({
  name: 'jobs',
  initialState,
  reducers: {
    // --- Job lifecycle ---

    addJob: (state, action: PayloadAction<Job>) => {
      state.jobs[action.payload.id] = action.payload;
    },

    updateJobStatus: (
      state,
      action: PayloadAction<{
        id: string;
        status: JobStatus;
        error?: string | null;
        /**
         * When the run actually ended, for a terminal status recovered from a
         * durable record rather than watched live. Omit it for a live
         * transition, which ends now by definition. Passing it explicitly as
         * `null` says "ended, but at an unknown time" — an interrupted run whose
         * record never got a completion stamp — which reads more honestly as no
         * duration than as a fabricated one.
         */
        completedAt?: number | null;
      }>,
    ) => {
      const job = state.jobs[action.payload.id];
      if (!job) return;

      job.status = action.payload.status;

      if (action.payload.error !== undefined) {
        job.error = action.payload.error;
      }

      if (
        action.payload.status === 'running' ||
        action.payload.status === 'preparing'
      ) {
        job.startedAt ??= Date.now();
      }

      if (
        action.payload.status === 'completed' ||
        action.payload.status === 'failed' ||
        action.payload.status === 'cancelled'
      ) {
        // Tested against undefined, not truthiness: an explicit `null` has to
        // survive as "ended at an unknown time".
        const { completedAt } = action.payload;
        job.completedAt = completedAt === undefined ? Date.now() : completedAt;
      }
    },

    // --- Training-specific progress ---

    updateTrainingProgress: (
      state,
      action: PayloadAction<{ id: string; progress: TrainingProgress }>,
    ) => {
      const job = state.jobs[action.payload.id];
      if (!job || job.type !== 'training') return;

      // A terminal tick (notably cancel) can arrive without the sample list and
      // log tail the streaming ticks carry, and this reducer replaces progress
      // wholesale — so guard the two cumulative snapshots that only ever grow:
      // keep the previous non-empty value when the incoming one is empty. This
      // is the last line of defence before the run is archived to history (the
      // sidecar carries these forward too; see job_manager `_accumulate_progress`).
      const prevSamples = job.progress?.samples ?? [];
      const prevLogLines = job.progress?.logLines ?? [];

      job.progress = action.payload.progress;

      if (job.progress.samples.length === 0 && prevSamples.length > 0) {
        job.progress.samples = prevSamples;
      }
      if (job.progress.logLines.length === 0 && prevLogLines.length > 0) {
        job.progress.logLines = prevLogLines;
      }

      // Sync status from progress
      const progressStatus = action.payload.progress.status;
      if (progressStatus === 'pending') {
        job.status = 'pending';
      } else if (progressStatus === 'preparing') {
        job.status = 'preparing';
      } else if (progressStatus === 'training') {
        job.status = 'running';
        job.startedAt ??= action.payload.progress.startedAt;
      } else if (progressStatus === 'completed') {
        job.status = 'completed';
        job.completedAt = action.payload.progress.completedAt ?? Date.now();
      } else if (progressStatus === 'failed') {
        job.status = 'failed';
        job.error = action.payload.progress.error;
        job.completedAt = action.payload.progress.completedAt ?? Date.now();
      } else if (progressStatus === 'cancelled') {
        job.status = 'cancelled';
        job.completedAt = action.payload.progress.completedAt ?? Date.now();
      }
    },

    /**
     * Repoint a training job's samples at their archived paths after the
     * terminal-time archive move, so the live detail view never references
     * files the archive step has relocated. Guarded: job must exist, be a
     * training job, and have progress.
     */
    updateTrainingSamples: (
      state,
      action: PayloadAction<{ id: string; samples: SampleImage[] }>,
    ) => {
      const job = state.jobs[action.payload.id];
      if (!job || job.type !== 'training' || !job.progress) return;
      job.progress.samples = action.payload.samples;
    },

    // --- Download-specific progress ---

    updateDownloadProgress: (
      state,
      action: PayloadAction<{
        id: string;
        progress: NonNullable<DownloadJob['progress']>;
      }>,
    ) => {
      const job = state.jobs[action.payload.id];
      if (!job || job.type !== 'download') return;

      job.progress = action.payload.progress;
      job.status = 'running';
      job.startedAt ??= Date.now();
    },

    // Terminal download transitions go through `updateJobStatus` like any
    // other job's. There were dedicated `completeDownload`/`failDownload`
    // reducers here while the browser drove the transfer; one of them existed
    // purely to snap a sampled byte count up to the total on completion, which
    // the sidecar now reports exactly.

    // --- Tagging-specific progress ---

    updateTaggingProgress: (
      state,
      action: PayloadAction<{ id: string; progress: TaggingProgress }>,
    ) => {
      const job = state.jobs[action.payload.id];
      if (!job || job.type !== 'tagging' || isTerminalStatus(job.status)) {
        return;
      }

      job.progress = action.payload.progress;
      job.status = 'running';
      job.startedAt ??= Date.now();
    },

    /**
     * Record the latest finished image and what it produced. Kept off
     * `progress` deliberately: progress payloads are whole-object replaces,
     * so a result stored there would be wiped by the very next counter tick.
     */
    recordTaggingResult: (
      state,
      action: PayloadAction<{ id: string } & TaggingResult>,
    ) => {
      const { id, ...result } = action.payload;
      const job = state.jobs[id];
      if (!job || job.type !== 'tagging' || isTerminalStatus(job.status)) {
        return;
      }

      job.lastResult = result;
    },

    completeTagging: (
      state,
      action: PayloadAction<{ id: string; summary: TaggingSummary }>,
    ) => {
      const job = state.jobs[action.payload.id];
      if (!job || job.type !== 'tagging') return;

      // First terminal status wins — the same rule the progress reducers above
      // follow. A `complete` event parsed just before the user's cancel landed
      // must not flip the job back out of `cancelled`, and the original
      // `completedAt` is when the run actually ended. The summary still
      // attaches when the earlier transition had none: it's the only record of
      // what the run produced.
      if (isTerminalStatus(job.status)) {
        job.summary ??= action.payload.summary;
        return;
      }

      job.summary = action.payload.summary;
      job.status = 'completed';
      job.completedAt = Date.now();
    },

    failTagging: (
      state,
      action: PayloadAction<{
        id: string;
        error: string;
        // A failed batch can still have produced results worth summarising —
        // the detail view renders the stat row and per-image errors for a
        // failed job just as it does for a completed one.
        summary?: TaggingSummary;
      }>,
    ) => {
      const job = state.jobs[action.payload.id];
      if (!job || job.type !== 'tagging') return;

      if (isTerminalStatus(job.status)) {
        if (action.payload.summary) job.summary ??= action.payload.summary;
        return;
      }

      job.status = 'failed';
      job.error = action.payload.error;
      if (action.payload.summary) job.summary = action.payload.summary;
      job.completedAt = Date.now();
    },

    cancelTagging: (state, action: PayloadAction<string>) => {
      const job = state.jobs[action.payload];
      if (!job || job.type !== 'tagging' || isTerminalStatus(job.status))
        return;

      job.status = 'cancelled';
      job.completedAt = Date.now();
    },

    // --- Restore (for persistence across refreshes) ---

    restoreJobs: (state, action: PayloadAction<Job[]>) => {
      for (const job of action.payload) {
        // Don't overwrite a job that's already in state
        if (!state.jobs[job.id]) {
          state.jobs[job.id] = job;
        }
      }
    },

    // --- Cleanup ---

    removeJob: (state, action: PayloadAction<string>) => {
      delete state.jobs[action.payload];
    },

    clearCompletedJobs: (state) => {
      for (const [id, job] of Object.entries(state.jobs)) {
        if (
          job.status === 'completed' ||
          job.status === 'failed' ||
          job.status === 'cancelled' ||
          job.status === 'interrupted'
        ) {
          delete state.jobs[id];
        }
      }
    },

    // --- Panel ---

    openPanel: (state) => {
      state.panelOpen = true;
    },

    closePanel: (state) => {
      state.panelOpen = false;
    },

    togglePanel: (state) => {
      state.panelOpen = !state.panelOpen;
    },

    // --- Detail modal ---

    openJobDetail: (
      state,
      action: PayloadAction<{ id: string; type: 'training' | 'tagging' }>,
    ) => {
      state.detailJob = action.payload;
    },

    closeJobDetail: (state) => {
      state.detailJob = null;
    },
  },
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const jobsReducer = jobsSlice.reducer;

export const {
  addJob,
  updateJobStatus,
  updateTrainingProgress,
  updateTrainingSamples,
  updateDownloadProgress,
  updateTaggingProgress,
  recordTaggingResult,
  completeTagging,
  failTagging,
  cancelTagging,
  restoreJobs,
  removeJob,
  clearCompletedJobs,
  openPanel,
  closePanel,
  togglePanel,
  openJobDetail,
  closeJobDetail,
} = jobsSlice.actions;

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

const selectJobs = (state: RootState) => state.jobs;

const selectAllJobs = createSelector(selectJobs, (s) =>
  Object.values(s.jobs).sort((a, b) => a.createdAt - b.createdAt),
);

/**
 * Look up a single job by ID. Used by UI that must keep reading live job
 * state after its own parent panel has hidden itself (e.g. a detail modal
 * that stays open while the activity panel disappears behind it).
 *
 * The id is a selector *argument*, not a factory parameter: a factory called
 * inline (`selectJobById(id)(state)`) builds a fresh selector every render and
 * memoises nothing. `weakMapMemoize` caches per argument, so this one holds.
 */
export const selectJobById = createSelector(
  [selectJobs, (_state: RootState, id: string) => id],
  (s, id): Job | null => s.jobs[id] ?? null,
);

export const selectActiveJobs = createSelector(selectAllJobs, (jobs) =>
  jobs.filter((j) => j.status === 'running' || j.status === 'preparing'),
);

export const selectPendingJobs = createSelector(selectAllJobs, (jobs) =>
  jobs.filter((j) => j.status === 'pending'),
);

export const selectCompletedJobs = createSelector(selectAllJobs, (jobs) =>
  jobs.filter(
    (j) =>
      j.status === 'completed' ||
      j.status === 'failed' ||
      j.status === 'cancelled' ||
      j.status === 'interrupted',
  ),
);

/**
 * Every training job the panel currently holds, live or finished. Terminal
 * runs are seeded here from the durable archive, so this is the panel's view
 * of them — callers that need runs the panel has since cleared should read
 * `trainingHistory` as well.
 */
export const selectTrainingJobs = createSelector(selectAllJobs, (jobs) =>
  jobs.filter((j): j is TrainingJob => j.type === 'training'),
);

/** The single active training job (there can be at most one). */
const selectActiveTrainingJob = createSelector(
  selectAllJobs,
  (jobs): TrainingJob | null => {
    const found = jobs.find(
      (j): j is TrainingJob =>
        j.type === 'training' &&
        (j.status === 'running' || j.status === 'preparing'),
    );
    return found ?? null;
  },
);

/**
 * Find the most recent download job (active or otherwise) for a given model.
 * Used by in-modal rows to surface progress, interrupted state, and errors.
 */
export const selectDownloadJobByModelId = createSelector(
  [selectAllJobs, (_state: RootState, modelId: string) => modelId],
  (jobs, modelId): DownloadJob | null => {
    const matches = jobs.filter(
      (j): j is DownloadJob => j.type === 'download' && j.modelId === modelId,
    );
    if (matches.length === 0) return null;
    // Most recent wins
    return matches.reduce((latest, j) =>
      j.createdAt > latest.createdAt ? j : latest,
    );
  },
);

/** Whether any training job is currently running (blocks GPU). */
export const selectIsTraining = createSelector(
  selectActiveTrainingJob,
  (job) => job !== null,
);

/**
 * Whether GPU work is already running or waiting, so a new run would go onto
 * the sidecar's queue rather than starting straight away. Training jobs sit at
 * `pending` while queued; tagging batches stay `running` with a `queued`
 * sub-state, so all three statuses count. Downloads are excluded — they don't
 * contend for the GPU.
 */
export const selectGpuQueueOccupied = createSelector(
  selectAllJobs,
  (jobs): boolean =>
    jobs.some(
      (j) =>
        (j.type === 'training' || j.type === 'tagging') &&
        (j.status === 'pending' ||
          j.status === 'preparing' ||
          j.status === 'running'),
    ),
);

/** The active tagging job for a specific project (at most one per project). */
export const selectActiveTaggingJob = createSelector(
  [
    selectAllJobs,
    (_state: RootState, projectFolderName: string) => projectFolderName,
  ],
  (jobs, projectFolderName): TaggingJob | null => {
    const found = jobs.find(
      (j): j is TaggingJob =>
        j.type === 'tagging' &&
        j.projectFolderName === projectFolderName &&
        (j.status === 'running' || j.status === 'preparing'),
    );
    return found ?? null;
  },
);

/** Any active tagging job across all projects. */
const selectAnyActiveTaggingJob = createSelector(
  selectAllJobs,
  (jobs): TaggingJob | null => {
    const found = jobs.find(
      (j): j is TaggingJob =>
        j.type === 'tagging' &&
        (j.status === 'running' || j.status === 'preparing'),
    );
    return found ?? null;
  },
);

/** The reason the GPU is busy, or null if idle. Used for guard error messages. */
export const selectGpuBusyReason = createSelector(
  selectActiveTrainingJob,
  selectAnyActiveTaggingJob,
  (training, tagging): 'training' | 'tagging' | null => {
    if (training !== null) return 'training';
    if (tagging !== null) return 'tagging';
    return null;
  },
);

/** Whether the activity panel is open. */
export const selectPanelOpen = createSelector(selectJobs, (s) => s.panelOpen);

/** Which job's detail modal is open, if any. */
export const selectDetailJob = createSelector(selectJobs, (s) => s.detailJob);

/** Whether there are any active or completed jobs to show. */
export const selectHasJobs = createSelector(
  selectAllJobs,
  (jobs) => jobs.length > 0,
);

// Re-export types
export type {
  DownloadJob,
  Job,
  JobStatus,
  TaggingImageError,
  TaggingJob,
  TrainingJob,
};
