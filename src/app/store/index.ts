import {
  type Action,
  combineReducers,
  configureStore,
  type ThunkAction,
} from '@reduxjs/toolkit';

import { assetImportReducer } from './asset-import';
import { assetsReducer } from './assets';
import { autoTaggerReducer } from './auto-tagger';
import { filtersReducer } from './filters';
import { jobsReducer } from './jobs';
import { filterManagerMiddleware } from './middleware/filter-manager';
import { jobPersistenceMiddleware } from './middleware/job-persistence';
import { modelManagerReducer } from './model-manager';
import { preferencesReducer } from './preferences';
import { projectReducer } from './project';
import { projectListReducer } from './project-list';
import { selectionReducer } from './selection';
import { toastsReducer } from './toasts';
import { trainingConfigReducer } from './training-config';
import { trainingHistoryReducer } from './training-history';

const rootReducer = combineReducers({
  assetImport: assetImportReducer,
  assets: assetsReducer,
  autoTagger: autoTaggerReducer,
  filters: filtersReducer,
  jobs: jobsReducer,
  modelManager: modelManagerReducer,
  preferences: preferencesReducer,
  project: projectReducer,
  projectList: projectListReducer,
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
    // Redux DevTools ship the whole action stream to the extension; that's a
    // development affordance, not something a production bundle should carry.
    devTools: process.env.NODE_ENV !== 'production',
    reducer: rootReducer,
    preloadedState,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        // RTK's two dev-only invariant checks deep-walk the *entire* root
        // state on every dispatch, not just what the action touched. A live
        // training run dispatches a progress tick about once a second, and
        // each of those ticks re-walks every archived run's loss and speed
        // series (1,000 points apiece, per the sidecar's cap) alongside the
        // live one — work that scales with how much history is loaded rather
        // than with what changed, and what trips the 32ms warning on longer
        // runs. Both subtrees are JSON straight off the sidecar wire, so
        // there is nothing in them for either check to find.
        serializableCheck: {
          ignoredPaths: ['jobs.jobs', 'trainingHistory.entries'],
          ignoredActions: ['jobs/updateTrainingProgress'],
        },
        immutableCheck: {
          ignoredPaths: ['jobs.jobs', 'trainingHistory.entries'],
        },
      })
        .concat(filterManagerMiddleware.middleware)
        .concat(jobPersistenceMiddleware.middleware),
  });
};

export type AppStore = ReturnType<typeof makeStore>;

export type AppDispatch = AppStore['dispatch'];

/**
 * @public For async operations
 *
 * The type parameter is the dispatch return value. It defaults to `void` —
 * most thunks are fire-and-forget — but a caller that needs to await the
 * outcome (routing that has to know whether a load succeeded, say) can
 * declare `AppThunk<Promise<T>>`.
 */
export type AppThunk<R = void> = ThunkAction<R, RootState, unknown, Action>;
