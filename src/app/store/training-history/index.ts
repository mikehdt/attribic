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

/**
 * A single archived run — a snapshot of the job when it reached a terminal
 * state. `dismissedFromPanel` tracks whether the user has cleared it from the
 * activity panel; the run stays in this archive (and the Run History view)
 * regardless. This is what lets a single store back both the transient panel
 * list and the durable history without a second persisted copy.
 */
export type TrainingHistoryEntry = TrainingJob & {
  dismissedFromPanel?: boolean;
};

type TrainingHistoryState = {
  entries: Record<string, TrainingHistoryEntry>;
};

const initialState: TrainingHistoryState = { entries: {} };

const trainingHistorySlice = createSlice({
  name: 'trainingHistory',
  initialState,
  reducers: {
    /**
     * Insert or replace a run's snapshot (keyed by job id). Preserves an
     * existing `dismissedFromPanel` flag so re-recording the same terminal run
     * doesn't resurrect it in the activity panel after a "Clear all".
     */
    recordTrainingRun: (state, action: PayloadAction<TrainingHistoryEntry>) => {
      const existing = state.entries[action.payload.id];
      state.entries[action.payload.id] = {
        ...action.payload,
        dismissedFromPanel:
          action.payload.dismissedFromPanel ??
          existing?.dismissedFromPanel ??
          false,
      };
    },

    /**
     * Mark every archived run as cleared from the activity panel. Backs the
     * panel's "Clear all" — the runs vanish from the panel but remain in the
     * Run History archive.
     */
    dismissAllFromPanel: (state) => {
      for (const entry of Object.values(state.entries)) {
        entry.dismissedFromPanel = true;
      }
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
    restoreHistory: (state, action: PayloadAction<TrainingHistoryEntry[]>) => {
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
  dismissAllFromPanel,
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
      (a, b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt),
    ),
);
