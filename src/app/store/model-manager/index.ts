/**
 * Model manager Redux slice.
 *
 * Tracks model inventory (what's installed, where) separately from
 * active download operations (which live in the jobs slice).
 */

import {
  createAsyncThunk,
  createSelector,
  createSlice,
  type PayloadAction,
} from '@reduxjs/toolkit';

import type { ModelStatus } from '@/app/services/model-manager/types';

import type { RootState } from '../index';
import type { ModelManagerState } from './types';

const initialState: ModelManagerState = {
  models: {},
  modelsFolder: null,
  isScanning: false,
  hasLoadedStatuses: false,
  isModalOpen: false,
  modalInitialTab: undefined,
  modalInitialModelId: undefined,
};

type StatusResponse = {
  statuses?: Record<
    string,
    {
      status: ModelStatus;
      localPath: string | null;
      resolvedPath?: string | null;
    }
  >;
  modelsFolder?: string;
};

/**
 * Fetch installation statuses for all downloadable models from disk.
 * The single entry point for status loading — dispatched on modal open
 * and on training form mount.
 */
export const fetchModelStatuses = createAsyncThunk(
  'modelManager/fetchStatuses',
  async (): Promise<StatusResponse> => {
    const res = await fetch('/api/model-manager/status');
    if (!res.ok) throw new Error(`Status check failed (${res.status})`);
    return (await res.json()) as StatusResponse;
  },
);

const modelManagerSlice = createSlice({
  name: 'modelManager',
  initialState,
  reducers: {
    // --- Model status ---

    /** Set the status and optional path for a single model. */
    setModelStatus: (
      state,
      action: PayloadAction<{
        modelId: string;
        status: ModelStatus;
        localPath?: string | null;
        resolvedPath?: string | null;
        sizeBytes?: number;
      }>,
    ) => {
      const { modelId, status, localPath, resolvedPath, sizeBytes } =
        action.payload;
      const existing = state.models[modelId];
      state.models[modelId] = {
        modelId,
        status,
        localPath: localPath ?? existing?.localPath ?? null,
        resolvedPath: resolvedPath ?? existing?.resolvedPath ?? null,
        sizeBytes: sizeBytes ?? existing?.sizeBytes ?? 0,
      };
    },

    // --- Storage config ---

    setIsScanning: (state, action: PayloadAction<boolean>) => {
      state.isScanning = action.payload;
    },

    // --- Modal UI ---

    openModelManagerModal: (
      state,
      action: PayloadAction<
        | {
            tab?: 'auto-tagger' | 'training' | 'settings';
            modelId?: string;
          }
        | undefined
      >,
    ) => {
      state.isModalOpen = true;
      state.modalInitialTab = action.payload?.tab;
      state.modalInitialModelId = action.payload?.modelId;
    },

    closeModelManagerModal: (state) => {
      state.isModalOpen = false;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchModelStatuses.pending, (state) => {
        state.isScanning = true;
      })
      .addCase(fetchModelStatuses.fulfilled, (state, action) => {
        for (const [modelId, entry] of Object.entries(
          action.payload.statuses ?? {},
        )) {
          const existing = state.models[modelId];
          state.models[modelId] = {
            modelId,
            status: entry.status,
            localPath: entry.localPath,
            resolvedPath: entry.resolvedPath ?? null,
            sizeBytes: existing?.sizeBytes ?? 0,
          };
        }
        if (action.payload.modelsFolder) {
          state.modelsFolder = action.payload.modelsFolder;
        }
        state.hasLoadedStatuses = true;
        state.isScanning = false;
      })
      .addCase(fetchModelStatuses.rejected, (state) => {
        // Statuses fall back to whatever was last seen
        state.isScanning = false;
      });
  },
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const modelManagerReducer = modelManagerSlice.reducer;

export const {
  setModelStatus,

  setIsScanning,
  openModelManagerModal,
  closeModelManagerModal,
} = modelManagerSlice.actions;

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

const selectModelManager = (state: RootState) => state.modelManager;

export const selectIsModelManagerModalOpen = createSelector(
  selectModelManager,
  (s) => s.isModalOpen,
);

export const selectModelManagerInitialTab = createSelector(
  selectModelManager,
  (s) => s.modalInitialTab,
);

export const selectModelManagerInitialModelId = createSelector(
  selectModelManager,
  (s) => s.modalInitialModelId,
);

export const selectIsScanningModels = createSelector(
  selectModelManager,
  (s) => s.isScanning,
);

export const selectHasLoadedModelStatuses = createSelector(
  selectModelManager,
  (s) => s.hasLoadedStatuses,
);

/** All model entries as a status map (modelId → { status, localPath }). */
export const selectAllModelStatuses = createSelector(
  selectModelManager,
  (s) => s.models,
);

// Re-export types
