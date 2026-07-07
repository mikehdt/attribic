/**
 * Training run history slice.
 *
 * A durable archive of terminal training runs (completed/failed/cancelled),
 * separate from the transient `jobs` slice. The activity panel's "Clear all"
 * wipes the jobs slice; this one survives so the Training menu's "Run History"
 * view keeps a lasting record. Entries are snapshots of the `TrainingJob` at
 * the moment it finished, so the detail view can render them exactly like a
 * live job (loss graph, params, log).
 *
 * Recording happens in `middleware/job-persistence.ts`, which upserts any
 * terminal training job into this slice; persistence lives in
 * `training-history/persistence.ts`.
 */

import {
  createSelector,
  createSlice,
  type PayloadAction,
} from '@reduxjs/toolkit';

import type { RootState } from '../index';
import type { TrainingJob } from '../jobs/types';

/** A single archived run — a snapshot of the job when it reached a terminal state. */
export type TrainingHistoryEntry = TrainingJob;

type TrainingHistoryState = {
  entries: Record<string, TrainingHistoryEntry>;
};

const initialState: TrainingHistoryState = { entries: {} };

const trainingHistorySlice = createSlice({
  name: 'trainingHistory',
  initialState,
  reducers: {
    /** Insert or replace a run's snapshot (keyed by job id). */
    recordTrainingRun: (
      state,
      action: PayloadAction<TrainingHistoryEntry>,
    ) => {
      state.entries[action.payload.id] = action.payload;
    },

    /** Remove a single run from the archive. */
    deleteHistoryEntry: (state, action: PayloadAction<string>) => {
      delete state.entries[action.payload];
    },

    /** Wipe the whole archive. */
    clearHistory: (state) => {
      state.entries = {};
    },

    /**
     * Merge persisted entries in on load. Only fills gaps — never overwrites a
     * snapshot already recorded this session, so a fresher in-memory run wins.
     */
    restoreHistory: (
      state,
      action: PayloadAction<TrainingHistoryEntry[]>,
    ) => {
      for (const entry of action.payload) {
        if (!state.entries[entry.id]) {
          state.entries[entry.id] = entry;
        }
      }
    },
  },
});

export const trainingHistoryReducer = trainingHistorySlice.reducer;

export const {
  recordTrainingRun,
  deleteHistoryEntry,
  clearHistory,
  restoreHistory,
} = trainingHistorySlice.actions;

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

const selectHistoryState = (state: RootState) => state.trainingHistory;

/** All archived runs, most recently finished first. */
export const selectTrainingHistory = createSelector(
  selectHistoryState,
  (s): TrainingHistoryEntry[] =>
    Object.values(s.entries).sort(
      (a, b) =>
        (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt),
    ),
);
