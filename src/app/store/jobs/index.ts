/**
 * Unified jobs slice.
 *
 * Tracks all long-running operations: training runs, model downloads,
 * and future generation jobs. The activity panel reads from this slice.
 */

import {
  createSelector,
  createSlice,
  type PayloadAction,
} from '@reduxjs/toolkit';

import type { TrainingProgress } from '@/app/services/training/types';

import type { RootState } from '../index';
import type {
  DownloadJob,
  Job,
  JobsState,
  JobStatus,
  TaggingJob,
  TaggingProgress,
  TaggingSummary,
  TrainingJob,
} from './types';

const initialState: JobsState = {
  jobs: {},
  panelOpen: false,
};

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
        job.completedAt = Date.now();
      }
    },

    // --- Training-specific progress ---

    updateTrainingProgress: (
      state,
      action: PayloadAction<{ id: string; progress: TrainingProgress }>,
    ) => {
      const job = state.jobs[action.payload.id];
      if (!job || job.type !== 'training') return;

      job.progress = action.payload.progress;

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
        job.completedAt = Date.now();
      } else if (progressStatus === 'cancelled') {
        job.status = 'cancelled';
        job.completedAt = Date.now();
      }
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

    completeDownload: (state, action: PayloadAction<string>) => {
      const job = state.jobs[action.payload];
      if (!job || job.type !== 'download') return;

      job.status = 'completed';
      job.completedAt = Date.now();
    },

    failDownload: (
      state,
      action: PayloadAction<{ id: string; error: string }>,
    ) => {
      const job = state.jobs[action.payload.id];
      if (!job || job.type !== 'download') return;

      job.status = 'failed';
      job.error = action.payload.error;
      job.completedAt = Date.now();
    },

    // --- Tagging-specific progress ---

    updateTaggingProgress: (
      state,
      action: PayloadAction<{ id: string; progress: TaggingProgress }>,
    ) => {
      const job = state.jobs[action.payload.id];
      if (!job || job.type !== 'tagging') return;

      job.progress = action.payload.progress;
      job.status = 'running';
      job.startedAt ??= Date.now();
    },

    completeTagging: (
      state,
      action: PayloadAction<{ id: string; summary: TaggingSummary }>,
    ) => {
      const job = state.jobs[action.payload.id];
      if (!job || job.type !== 'tagging') return;

      job.summary = action.payload.summary;
      job.status = 'completed';
      job.completedAt = Date.now();
    },

    failTagging: (
      state,
      action: PayloadAction<{ id: string; error: string }>,
    ) => {
      const job = state.jobs[action.payload.id];
      if (!job || job.type !== 'tagging') return;

      job.status = 'failed';
      job.error = action.payload.error;
      job.completedAt = Date.now();
    },

    cancelTagging: (state, action: PayloadAction<string>) => {
      const job = state.jobs[action.payload];
      if (!job || job.type !== 'tagging') return;

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
  updateDownloadProgress,
  completeDownload,
  failDownload,
  updateTaggingProgress,
  completeTagging,
  failTagging,
  cancelTagging,
  restoreJobs,
  removeJob,
  clearCompletedJobs,
  openPanel,
  closePanel,
  togglePanel,
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
 */
export const selectJobById = (id: string) =>
  createSelector(selectJobs, (s): Job | null => s.jobs[id] ?? null);

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

/** The single active training job (there can be at most one). */
export const selectActiveTrainingJob = createSelector(
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
export const selectDownloadJobByModelId = (modelId: string) =>
  createSelector(selectAllJobs, (jobs): DownloadJob | null => {
    const matches = jobs.filter(
      (j): j is DownloadJob => j.type === 'download' && j.modelId === modelId,
    );
    if (matches.length === 0) return null;
    // Most recent wins
    return matches.reduce((latest, j) =>
      j.createdAt > latest.createdAt ? j : latest,
    );
  });

/**
 * Model IDs with a download in flight or queued (pending/preparing/running).
 * Lets the model manager un-fade a model's dependencies the moment its
 * download starts or is queued, not only once it finishes.
 */
export const selectDownloadingModelIds = createSelector(
  selectAllJobs,
  (jobs): Set<string> => {
    const ids = new Set<string>();
    for (const j of jobs) {
      if (
        j.type === 'download' &&
        (j.status === 'pending' ||
          j.status === 'preparing' ||
          j.status === 'running')
      ) {
        ids.add(j.modelId);
      }
    }
    return ids;
  },
);

/** Whether any training job is currently running (blocks GPU). */
export const selectIsTraining = createSelector(
  selectActiveTrainingJob,
  (job) => job !== null,
);

/** The active tagging job for a specific project (at most one per project). */
export const selectActiveTaggingJob = (projectFolderName: string) =>
  createSelector(selectAllJobs, (jobs): TaggingJob | null => {
    const found = jobs.find(
      (j): j is TaggingJob =>
        j.type === 'tagging' &&
        j.projectFolderName === projectFolderName &&
        (j.status === 'running' || j.status === 'preparing'),
    );
    return found ?? null;
  });

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

/** Whether the GPU is busy (training or tagging active — blocks other GPU work). */
export const selectIsGpuBusy = createSelector(
  selectActiveTrainingJob,
  selectAnyActiveTaggingJob,
  (training, tagging) => training !== null || tagging !== null,
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
  TaggingJob,
  TaggingProgress,
  TaggingSummary,
  TrainingJob,
};
