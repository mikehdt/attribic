/**
 * Client-side hook exposing which training backends have an install location
 * saved in config.json `trainingBackends`.
 *
 * Backed by a module-level cache so every consumer (the model manager's
 * training tab, the training form's Backend dropdown) shares one fetch.
 * `refreshConfiguredBackends` is exported for the Settings tab to call after
 * saving, so live consumers update without remounting.
 *
 * Mirrors the shape of {@link useHfTokenStatus} deliberately — same cache,
 * same subscriber notification, same "null while unknown" contract.
 */

'use client';

import { useEffect, useState } from 'react';

import type { TrainingProvider } from '@/app/services/training/types';

/** The backends that can actually be installed (the mock trainer needs none). */
const REAL_PROVIDERS: TrainingProvider[] = [
  'ai-toolkit',
  'kohya',
  'musubi',
  'fizgig',
];

/** provider → whether a folder is saved for it. Null until the config loads. */
export type ConfiguredBackends = Record<string, boolean> | null;

let cached: ConfiguredBackends = null;
let inFlight: Promise<void> | null = null;
const subscribers = new Set<(value: ConfiguredBackends) => void>();

function notify(value: ConfiguredBackends): void {
  for (const sub of subscribers) sub(value);
}

async function fetchBackends(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const res = await fetch('/api/config');
      if (!res.ok) throw new Error('config fetch failed');
      const data = (await res.json()) as {
        trainingBackends?: Record<string, string>;
      };
      const paths = data.trainingBackends ?? {};
      const map: Record<string, boolean> = {};
      for (const provider of REAL_PROVIDERS) {
        map[provider] = Boolean(paths[provider]?.trim());
      }
      cached = map;
    } catch {
      // Leave the cache as-is. Staying null means consumers treat every
      // backend as configured rather than wrongly steering to Settings.
    } finally {
      inFlight = null;
    }
    notify(cached);
  })();
  return inFlight;
}

/** Invalidate the cache and refetch. Subscribers are notified on completion. */
export function refreshConfiguredBackends(): void {
  cached = null;
  notify(null);
  void fetchBackends();
}

/**
 * Which backends have a location saved. Returns `null` while the first fetch
 * is pending (or if it failed) — callers should read that as "unknown" and
 * assume everything is available rather than hiding options.
 */
export function useConfiguredBackends(): ConfiguredBackends {
  const [value, setValue] = useState<ConfiguredBackends>(cached);

  useEffect(() => {
    subscribers.add(setValue);
    if (cached === null) void fetchBackends();
    return () => {
      subscribers.delete(setValue);
    };
  }, []);

  return value;
}
