'use client';

import { useEffect, useState } from 'react';
import { Provider as ReduxProvider } from 'react-redux';

import { makeStore } from '../store';
import {
  hydratePreferences,
  subscribePreferencesPersistence,
} from '../store/preferences';
import { loadPreferences } from '../store/preferences/local-storage';
import type { PreferencesState } from '../store/preferences/types';
import { makeTrainingConfigState } from '../store/training-config';

type StoreProviderProps = {
  children: React.ReactNode;
  /**
   * Preferences read from the cookie server-side. When present, the server
   * already rendered the user's real values, so we seed the store with them
   * and skip the post-mount localStorage reconciliation (no flash). Absent on
   * a first visit / cleared cookie, where we fall back to localStorage.
   */
  preloadedPreferences?: PreferencesState | null;
};

export const StoreProvider = ({
  children,
  preloadedPreferences,
}: StoreProviderProps) => {
  // Create the store once, seeding preferences from the server-provided
  // cookie state so the first client render matches the server HTML. The
  // training form starts on the last-chosen model for the same reason —
  // both sides derive it from the same cookie, so no post-mount flip.
  const [store] = useState(() => {
    const s = makeStore(
      preloadedPreferences
        ? {
            preferences: preloadedPreferences,
            trainingConfig: makeTrainingConfigState(
              preloadedPreferences.lastTrainingModelId,
            ),
          }
        : undefined,
    );
    subscribePreferencesPersistence(s);
    return s;
  });

  const hasPreloaded = preloadedPreferences != null;

  useEffect(() => {
    // Reconcile from localStorage only when the server DIDN'T seed us from the
    // cookie (first visit, cleared cookie, or a pre-cookie user migrating). In
    // that case the server rendered defaults, so applying persisted values
    // here may flip once — the subscriber then writes the cookie so subsequent
    // loads SSR correctly. When the cookie was present we skip this entirely to
    // avoid a redundant flash.
    if (!hasPreloaded) {
      store.dispatch(hydratePreferences(loadPreferences()));
    }
  }, [store, hasPreloaded]);

  return <ReduxProvider store={store}>{children}</ReduxProvider>;
};
