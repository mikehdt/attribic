import { PayloadAction } from '@reduxjs/toolkit';

import {
  PreferencesState,
  TagEditMode,
  TaggingViewMode,
  ThemeMode,
  TrainingViewMode,
} from './types';

export const coreReducers = {
  setTheme: (
    state: PreferencesState,
    { payload }: PayloadAction<ThemeMode>,
  ) => {
    state.theme = payload;
  },

  setTagEditMode: (
    state: PreferencesState,
    { payload }: PayloadAction<TagEditMode>,
  ) => {
    state.tagEditMode = payload;
  },

  setTrainingViewMode: (
    state: PreferencesState,
    { payload }: PayloadAction<TrainingViewMode>,
  ) => {
    state.trainingViewMode = payload;
  },

  setTaggingViewMode: (
    state: PreferencesState,
    { payload }: PayloadAction<TaggingViewMode>,
  ) => {
    state.taggingViewMode = payload;
  },

  setKeepTaggerModelInMemory: (
    state: PreferencesState,
    { payload }: PayloadAction<boolean>,
  ) => {
    state.keepTaggerModelInMemory = payload;
  },

  setLastTrainingModelId: (
    state: PreferencesState,
    { payload }: PayloadAction<string>,
  ) => {
    state.lastTrainingModelId = payload;
  },
};
