/**
 * Training run history slice.
 *
 * An in-memory projection of the terminal training runs (completed/failed/
 * cancelled) the sidecar holds on disk, separate from the transient `jobs`
 * slice. The activity panel's "Clear all" wipes the jobs slice; this one
 * survives so the Training menu's "Run History" view keeps a lasting record.
 * Entries are `TrainingJob` snapshots, so the detail view can render an
 * archived run exactly like a live one (loss graph, params, log).
 *
 * **Not persisted.** The durable record of a run is the sidecar's
 * `<training>/jobs/<job_id>.json`, which is the single source of truth; this
 * slice is rebuilt from it on mount by `hydrateTrainingHistory`. It previously
 * persisted to localStorage as a second store, which drifted from disk in both
 * directions — runs outliving their deleted files, and runs vanishing with a
 * cleared browser store despite their outputs still being on disk.
 *
 * Two paths write here. `middleware/job-persistence.ts` upserts a run the
 * moment it goes terminal, so the archive updates without waiting for a
 * reload; `hydrateTrainingHistory` seeds the whole archive from the sidecar on
 * mount. Mutations that must outlive the session (dismiss, delete) are
 * mirrored to the sidecar by their dispatcher — this slice only holds the
 * client's copy.
 */

import {
  createSelector,
  createSlice,
  type PayloadAction,
} from '@reduxjs/toolkit';

import type { SampleImage } from '@/app/services/training/types';

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

    /**
     * Mark a single archived run as cleared from the activity panel. Backs a
     * training card's per-item "Clear" — without this the run stays in the
     * durable archive with `dismissedFromPanel: false` and gets re-seeded into
     * the panel on the next hard refresh.
     */
    dismissFromPanel: (state, action: PayloadAction<string>) => {
      const entry = state.entries[action.payload];
      if (entry) entry.dismissedFromPanel = true;
    },

    /**
     * Repoint a stored run's samples at their archived paths once the
     * terminal-time move completes. Only touches `progress.samples`; the rest
     * of the snapshot (and `dismissedFromPanel`) is untouched. The sidecar
     * archives samples as it collects them, so its own record already carries
     * the archived paths — this keeps the current session in step without
     * waiting for a reload to pick them up.
     */
    updateEntrySamples: (
      state,
      action: PayloadAction<{ id: string; samples: SampleImage[] }>,
    ) => {
      const entry = state.entries[action.payload.id];
      if (!entry?.progress) return;
      entry.progress.samples = action.payload.samples;
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
     * Merge the sidecar's records in on load. Only fills gaps — never
     * overwrites a snapshot already recorded this session, so a run that
     * finished while the page was open keeps its live, fuller state.
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
  updateEntrySamples,
  dismissAllFromPanel,
  dismissFromPanel,
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
