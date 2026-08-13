'use client';

import { useSyncExternalStore } from 'react';

import type { SystemStats } from './use-stats';

export type StatsSample = { t: number; stats: SystemStats };
export type SeriesPoint = { t: number; value: number };

/**
 * How far back the sparklines look. The full width of a stat card's graph is
 * this much wall-clock time, so a run's last ten minutes of load is always the
 * whole picture — change this one constant to widen or narrow the view.
 */
export const HISTORY_WINDOW_MS = 10 * 60 * 1000;

/** Several components poll independently; don't record the same moment twice. */
const MIN_SAMPLE_GAP_MS = 1000;

/** Backstop on the buffer if something ever polls far faster than it should. */
const MAX_SAMPLES = 512;

let samples: readonly StatsSample[] = [];
const listeners = new Set<() => void>();

/**
 * Push a fresh reading onto the rolling buffer, dropping anything that has
 * aged out of the window.
 *
 * Deliberately module-level rather than component state: the history has to
 * outlive the detail modal being closed and reopened, and every `useStats`
 * consumer should be feeding one shared timeline rather than each building a
 * private one that starts empty on mount. It is memory-only and dies with the
 * tab — nothing about host load belongs in a run's saved record.
 */
export const recordStatsSample = (stats: SystemStats, now = Date.now()) => {
  const last = samples[samples.length - 1];
  if (last && now - last.t < MIN_SAMPLE_GAP_MS) return;

  const cutoff = now - HISTORY_WINDOW_MS;
  const kept = samples.filter((s) => s.t >= cutoff);
  samples = [...kept, { t: now, stats }].slice(-MAX_SAMPLES);
  listeners.forEach((listener) => listener());
};

const clearStatsHistory = () => {
  if (samples.length === 0) return;
  samples = [];
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => samples;

const EMPTY: readonly StatsSample[] = [];
const getServerSnapshot = () => EMPTY;

/** The shared rolling buffer. Re-renders on every new sample. */
export const useStatsHistory = () =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

/**
 * Pull one figure out of every sample as a plottable series. Readings the
 * host didn't answer (`[N/A]` from nvidia-smi, psutil absent) drop out rather
 * than plotting as zero, which would read as a real idle period.
 */
export const toSeries = (
  history: readonly StatsSample[],
  pick: (stats: SystemStats) => number | null,
): SeriesPoint[] =>
  history.flatMap((sample) => {
    const value = pick(sample.stats);
    return value == null ? [] : [{ t: sample.t, value }];
  });

/** Memory as a share of the total, for plotting on the same 0–100 axis as utilisation. */
export const memoryPercent = (usedMb: number | null, totalMb: number | null) =>
  usedMb == null || totalMb == null || totalMb <= 0
    ? null
    : (usedMb / totalMb) * 100;
