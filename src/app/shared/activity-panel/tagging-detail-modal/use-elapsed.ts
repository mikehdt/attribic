import { useEffect, useState } from 'react';

/**
 * Elapsed milliseconds for a job, ticking once a second while it runs. Once
 * `completedAt` lands, the authoritative span takes over — it may differ from
 * the live estimate by a second or two, which is acceptable drift for a
 * progress readout.
 *
 * A 1s `setInterval` rather than `requestAnimationFrame`: the display only
 * changes once a second, so repainting every frame buys nothing.
 *
 * `now` is only ever stamped from the interval, never synchronously on mount or
 * when the effect re-arms — a setState in the effect body would cost a cascading
 * render every time a job starts. The cost is that a job starting well after
 * mount reads up to a second low until the first tick, which is inside the drift
 * this readout already tolerates.
 */
export function useElapsed(
  startedAt: number | null,
  completedAt: number | null,
): number | null {
  const running = startedAt != null && completedAt == null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running, startedAt]);

  if (startedAt == null) return null;
  if (completedAt != null) return completedAt - startedAt;
  return Math.max(0, now - startedAt);
}
