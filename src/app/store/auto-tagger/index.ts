/**
 * Auto-tagger Redux slice
 *
 * Tracks model inventory and selection for the tagging UI. Download
 * state lives in the unified jobs slice — see `startModelDownload`
 * and `useDownloadActions` for the lifecycle.
 */

import {
  createAsyncThunk,
  createSelector,
  createSlice,
  PayloadAction,
} from '@reduxjs/toolkit';

import type { AutoTaggerState, ModelInfo, ProviderInfo } from './types';

type ModelsResponse = {
  providers: ProviderInfo[];
  models: ModelInfo[];
};

/**
 * Retry ladder for the models fetch. On a fresh dev server the route can 404
 * for several seconds while Turbopack compiles it, and the answer decides
 * whether the Auto Tagger entry points are enabled at all — so a single
 * attempt would leave them greyed out until the user reloaded.
 */
const MODELS_RETRY_DELAYS_MS = [1000, 3000, 6000];

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Load the model inventory into the slice.
 *
 * The single path for this: four call sites used to hand-roll it with three
 * different retry policies and no typing. `condition` makes it safe to fire
 * from anywhere on mount — concurrent or repeat dispatches are dropped rather
 * than re-fetching, so callers don't need a loaded/in-flight guard of their
 * own. A rejection leaves `isInitialised` false, so the next mount retries.
 */
export const fetchAutoTaggerModels = createAsyncThunk<
  ModelsResponse,
  void,
  { state: { autoTagger: AutoTaggerState }; rejectValue: string }
>(
  'autoTagger/fetchModels',
  async (_arg, { signal, rejectWithValue }) => {
    let lastError = 'Failed to load models';

    for (let attempt = 0; attempt <= MODELS_RETRY_DELAYS_MS.length; attempt++) {
      if (attempt > 0) {
        await wait(MODELS_RETRY_DELAYS_MS[attempt - 1]);
        if (signal.aborted) break;
      }
      try {
        const response = await fetch('/api/auto-tagger/models', { signal });
        if (!response.ok) {
          throw new Error(`Failed to load models (${response.status})`);
        }
        return (await response.json()) as ModelsResponse;
      } catch (err) {
        if (signal.aborted) break;
        if (err instanceof Error) lastError = err.message;
      }
    }

    return rejectWithValue(lastError);
  },
  {
    condition: (_arg, { getState }) => {
      const { isInitialised, isLoading } = getState().autoTagger;
      return !isInitialised && !isLoading;
    },
  },
);

const initialState: AutoTaggerState = {
  isInitialised: false,
  isLoading: false,
  providers: [],
  models: [],
  selectedModelId: null,
  error: null,
};

const autoTaggerSlice = createSlice({
  name: 'autoTagger',
  initialState,
  reducers: {
    // Update a single model's status (called by middleware when the
    // model-manager slice's setModelStatus fires).
    updateModelStatus: (
      state,
      action: PayloadAction<{
        modelId: string;
        status: ModelInfo['status'];
      }>,
    ) => {
      const model = state.models.find((m) => m.id === action.payload.modelId);
      if (model) {
        model.status = action.payload.status;
      }
    },

    // Set selected model for tagging
    setSelectedModel: (state, action: PayloadAction<string>) => {
      state.selectedModelId = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAutoTaggerModels.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchAutoTaggerModels.fulfilled, (state, action) => {
        state.providers = action.payload.providers;
        state.models = action.payload.models;
        state.isInitialised = true;
        state.isLoading = false;
        state.error = null;

        // Auto-select a ready model if none selected
        if (!state.selectedModelId) {
          const readyModel = action.payload.models.find(
            (m) => m.status === 'ready',
          );
          if (readyModel) {
            state.selectedModelId = readyModel.id;
          }
        }
      })
      .addCase(fetchAutoTaggerModels.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload ?? 'Failed to load models';
      });
  },
  selectors: {
    selectIsInitialised: (state) => state.isInitialised,
    selectProviders: (state) => state.providers,
    selectModels: (state) => state.models,
    selectSelectedModelId: (state) => state.selectedModelId,
    /** Why the models fetch failed, after its retries were exhausted. */
    selectModelsError: (state) => state.error,
  },
});

// Export reducer
export const { reducer: autoTaggerReducer } = autoTaggerSlice;

// Export actions
export const { setSelectedModel, updateModelStatus } = autoTaggerSlice.actions;

// Export basic selectors from slice
export const {
  selectIsInitialised,
  selectProviders,
  selectModels,
  selectSelectedModelId,
  selectModelsError,
} = autoTaggerSlice.selectors;

// Memoized derived selectors (to avoid creating new arrays/objects on each call)
export const selectHasReadyModel = createSelector([selectModels], (models) =>
  models.some((m) => m.status === 'ready'),
);

export const selectReadyModels = createSelector([selectModels], (models) =>
  models.filter((m) => m.status === 'ready'),
);

// Export types
export * from './types';
