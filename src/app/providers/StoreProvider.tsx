'use client';

import { useEffect, useState } from 'react';
import { Provider as ReduxProvider } from 'react-redux';

import { makeStore } from '../store';
import {
  hydratePreferences,
  subscribePreferencesPersistence,
} from '../store/preferences';
import { loadPreferences } from '../store/preferences/local-storage';

export const StoreProvider = ({ children }: { children: React.ReactNode }) => {
  // Use lazy initialization to create the store only once
  const [store] = useState(() => {
    const s = makeStore();
    subscribePreferencesPersistence(s);
    return s;
  });

  // Apply persisted preferences after mount. The store starts from
  // deterministic defaults so the first client render matches the server;
  // reading localStorage into the initial state instead would diverge and
  // cause hydration mismatches. Running here (post-hydration) is safe.
  useEffect(() => {
    store.dispatch(hydratePreferences(loadPreferences()));
  }, [store]);

  return <ReduxProvider store={store}>{children}</ReduxProvider>;
};
