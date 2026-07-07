/**
 * Model manager Redux slice.
 *
 * Tracks model inventory (what's installed, where) separately from
 * active download operations (which live in the jobs slice).
 */

import {
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
  isModalOpen: false,
  modalInitialTab: undefined,
};

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
        sizeBytes?: number;
      }>,
    ) => {
      const { modelId, status, localPath, sizeBytes } = action.payload;
      const existing = state.models[modelId];
      state.models[modelId] = {
        modelId,
        status,
        localPath: localPath ?? existing?.localPath ?? null,
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
        'auto-tagger' | 'training' | 'settings' | undefined
      >,
    ) => {
      state.isModalOpen = true;
      state.modalInitialTab = action.payload;
    },

    closeModelManagerModal: (state) => {
      state.isModalOpen = false;
    },
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

export const selectIsScanningModels = createSelector(
  selectModelManager,
  (s) => s.isScanning,
);

/** All model entries as a status map (modelId → { status, localPath }). */
export const selectAllModelStatuses = createSelector(
  selectModelManager,
  (s) => s.models,
);

// Re-export types
