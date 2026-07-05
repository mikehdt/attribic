import {
  type Action,
  configureStore,
  type ThunkAction,
} from '@reduxjs/toolkit';

import { assetsReducer } from './assets';
import { autoTaggerReducer } from './auto-tagger';
import { filtersReducer } from './filters';
import { jobsReducer } from './jobs';
import { filterManagerMiddleware } from './middleware/filter-manager';
import { jobPersistenceMiddleware } from './middleware/job-persistence';
import { modelManagerReducer } from './model-manager';
import { preferencesReducer } from './preferences';
import { projectReducer } from './project';
import { selectionReducer } from './selection';
import { toastsReducer } from './toasts';
import { trainingReducer } from './training';
import { trainingConfigReducer } from './training-config';

export const makeStore = () => {
  return configureStore({
    devTools: true,
    reducer: {
      assets: assetsReducer,
      autoTagger: autoTaggerReducer,
      filters: filtersReducer,
      jobs: jobsReducer,
      modelManager: modelManagerReducer,
      preferences: preferencesReducer,
      project: projectReducer,
      selection: selectionReducer,
      toasts: toastsReducer,
      training: trainingReducer,
      trainingConfig: trainingConfigReducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware()
        .concat(filterManagerMiddleware.middleware)
        .concat(jobPersistenceMiddleware.middleware),
  });
};

export type AppStore = ReturnType<typeof makeStore>;

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];

/**
 * @public For async operations
 */
export type AppThunk = ThunkAction<void, RootState, unknown, Action>;
