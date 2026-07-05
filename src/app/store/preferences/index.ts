import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import { preferenceDefaults, savePreferences } from './local-storage';
import { coreReducers } from './reducers';
import type { PreferencesState } from './types';

// Start from deterministic defaults so server and client agree on the first
// render; persisted values are applied after mount via `hydratePreferences`.
const initialState: PreferencesState = preferenceDefaults;

const preferencesSlice = createSlice({
  name: 'preferences',
  initialState,
  reducers: {
    ...coreReducers,
    /** Replace the whole state with persisted values (post-mount hydration). */
    hydratePreferences: (
      _state,
      action: PayloadAction<PreferencesState>,
    ): PreferencesState => action.payload,
  },
  selectors: {
    selectTheme: (state) => state.theme,
    selectTagEditMode: (state) => state.tagEditMode,
    selectTrainingViewMode: (state) => state.trainingViewMode,
    selectKeepTaggerModelInMemory: (state) => state.keepTaggerModelInMemory,
  },
});

export const { reducer: preferencesReducer } = preferencesSlice;
export const {
  setTheme,
  setTagEditMode,
  setTrainingViewMode,
  setKeepTaggerModelInMemory,
  hydratePreferences,
} = preferencesSlice.actions;
export const {
  selectTheme,
  selectTagEditMode,
  selectTrainingViewMode,
  selectKeepTaggerModelInMemory,
} = preferencesSlice.selectors;

/**
 * Subscribe to store changes and persist preferences to localStorage.
 * Call once after store creation.
 */
export const subscribePreferencesPersistence = (store: {
  getState: () => { preferences: PreferencesState };
  subscribe: (listener: () => void) => () => void;
}) => {
  let prev = store.getState().preferences;
  return store.subscribe(() => {
    const next = store.getState().preferences;
    if (next !== prev) {
      prev = next;
      savePreferences(next);
    }
  });
};

export type { ThemeMode, TrainingViewMode } from './types';
export { TagEditMode } from './types';
