'use client';

import { useState } from 'react';

import { Checkbox } from '../checkbox';

/**
 * Settings section for the start-on-launch sidecar toggle. Persisted to
 * config.json (not browser preferences) because it governs a server-side
 * process — every browser pointed at the app should agree on it.
 */
export function SidecarLaunchSection({
  initialEnabled,
}: {
  initialEnabled: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    const next = !enabled;
    setEnabled(next);
    setError(null);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startSidecarOnLaunch: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save');
      }
    } catch (err) {
      setEnabled(!next);
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="text-sm text-slate-500">
        <h3 className="text-lg font-medium text-slate-800 dark:text-slate-200">
          Training Sidecar
        </h3>
        <p className="mt-1">
          The Python sidecar runs training and VLM captioning. Starting it with
          the app means the first job isn&apos;t waiting on a cold start; leave
          this off to start it yourself from the global menu when needed.
        </p>
      </div>

      <Checkbox
        isSelected={enabled}
        onChange={toggle}
        label="Start the sidecar when the app launches"
      />

      {error && (
        <div className="rounded-md bg-rose-50 p-3 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}
    </section>
  );
}
