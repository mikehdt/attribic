'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * State for the keep-awake toggle. Backed by config.json rather than browser
 * preferences: the sidecar is what actually holds the sleep inhibition, it
 * reads the same key itself, and it outlives the browser that set it.
 *
 * `enabled` gates the read on the menu being open — the value is re-read on
 * every open rather than cached for the session, so a change made in another
 * tab (or by hand in config.json) shows up.
 */
export const useKeepAwakeToggle = (enabled: boolean) => {
  // null until the first read lands. Rendering the default (on) before then
  // would flash the wrong state for anyone who has turned it off.
  const [value, setValue] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch('/api/config', { signal: controller.signal });
        if (!res.ok) return;
        const data = (await res.json()) as { keepAwakeWhileBusy?: boolean };
        setValue(data.keepAwakeWhileBusy !== false);
      } catch {
        // Aborted on close, or the route is briefly unavailable during a dev
        // recompile — keep whatever we already had rather than guessing.
      }
    })();

    return () => controller.abort();
  }, [enabled]);

  const toggle = useCallback(async () => {
    if (value === null) return;

    const next = !value;
    setValue(next);
    setError(null);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keepAwakeWhileBusy: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save');
      }
    } catch (err) {
      setValue(!next);
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
  }, [value]);

  return { value, error, toggle };
};
