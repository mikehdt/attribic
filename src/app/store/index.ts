import {
  type Action,
  combineReducers,
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
import { trainingConfigReducer } from './training-config';
import { trainingHistoryReducer } from './training-history';

const rootReducer = combineReducers({
  assets: assetsReducer,
  autoTagger: autoTaggerReducer,
  filters: filtersReducer,
  jobs: jobsReducer,
  modelManager: modelManagerReducer,
  preferences: preferencesReducer,
  project: projectReducer,
  selection: selectionReducer,
  toasts: toastsReducer,
  trainingConfig: trainingConfigReducer,
  trainingHistory: trainingHistoryReducer,
});

// Root state inferred from the combined reducer so `makeStore` can accept a
// typed partial preloaded state without a circular type reference.
export type RootState = ReturnType<typeof rootReducer>;

/**
 * `makeStore` accepts an optional partial preloaded state. The server seeds the
 * preferences slice from a cookie (see StoreProvider) so the first client
 * render matches the server HTML without a post-mount hydration flip.
 */
export const makeStore = (preloadedState?: Partial<RootState>) => {
  return configureStore({
    devTools: true,
    reducer: rootReducer,
    preloadedState,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware()
        .concat(filterManagerMiddleware.middleware)
        .concat(jobPersistenceMiddleware.middleware),
  });
};

export type AppStore = ReturnType<typeof makeStore>;

export type AppDispatch = AppStore['dispatch'];

/**
 * @public For async operations
 */
export type AppThunk = ThunkAction<void, RootState, unknown, Action>;
