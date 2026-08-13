'use client';

import { useEffect, useSyncExternalStore } from 'react';

import { recordStatsSample } from './history';

/** One GPU's current load. Every figure is optional — nvidia-smi answers
 * `[N/A]` for anything a given card or driver doesn't expose. */
type GpuStats = {
  index: number;
  name: string;
  utilization: number | null;
  memoryUsedMb: number | null;
  memoryTotalMb: number | null;
  temperatureC: number | null;
};

/** Host load at a moment in time — machine-wide, never per-job. */
export type SystemStats = {
  cpuPercent: number | null;
  memoryUsedMb: number | null;
  memoryTotalMb: number | null;
  gpus: GpuStats[];
};

type StatsResponse = {
  cpu_percent?: number | null;
  memory_used_mb?: number | null;
  memory_total_mb?: number | null;
  gpus?: Array<{
    index?: number;
    name?: string;
    utilization?: number | null;
    memory_used_mb?: number | null;
    memory_total_mb?: number | null;
    temperature_c?: number | null;
  }>;
};

/**
 * How often to re-read. The sidecar caches for ~1s and each read spawns an
 * nvidia-smi, so polling faster than this buys nothing but process churn.
 */
const POLL_INTERVAL_MS = 2000;

/**
 * A failed read is retried sooner than a normal poll — a single 503 while the
 * sidecar restarts shouldn't cost a full interval of trace — then backs off,
 * so a sidecar that's genuinely down isn't hammered.
 */
const FIRST_RETRY_MS = 750;
const MAX_RETRY_MS = 5000;

/**
 * How long the last good sample stands in for a failed one. Under this, a
 * transient failure keeps the figures on screen (a stats row that blinks out
 * mid-run reads as a fault that isn't one); past it the readings are old
 * enough that showing them would be a lie, and the row hides instead.
 */
const STALE_AFTER_MS = 30_000;

const toStats = (data: StatsResponse): SystemStats => ({
  cpuPercent: data.cpu_percent ?? null,
  memoryUsedMb: data.memory_used_mb ?? null,
  memoryTotalMb: data.memory_total_mb ?? null,
  gpus: (data.gpus ?? []).map((gpu, i) => ({
    index: gpu.index ?? i,
    name: gpu.name ?? 'GPU',
    utilization: gpu.utilization ?? null,
    memoryUsedMb: gpu.memory_used_mb ?? null,
    memoryTotalMb: gpu.memory_total_mb ?? null,
    temperatureC: gpu.temperature_c ?? null,
  })),
});

// --- The poller ---------------------------------------------------------
//
// One loop for the whole tab, reference-counted by its consumers, rather than
// an interval per hook. Two surfaces watching the same machine used to mean
// two fetches and two nvidia-smi spawns for readings a second apart, most of
// which the history buffer then threw away as duplicates.
//
// It re-arms *after* each read completes instead of on a fixed interval: a
// setInterval keeps firing while a slow read is still in flight, so a stalled
// sidecar would queue requests that all land at once and then leave a hole.

let latest: SystemStats | null = null;
let lastSampleAt = 0;
let consumers = 0;
let timer: number | null = null;
let inFlight = false;
let failures = 0;

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

const clearTimer = () => {
  if (timer === null) return;
  window.clearTimeout(timer);
  timer = null;
};

const schedule = (delay: number) => {
  clearTimer();
  if (consumers === 0) return;
  timer = window.setTimeout(() => {
    timer = null;
    void poll();
  }, delay);
};

/** Drop figures too old to stand for "now" — see `STALE_AFTER_MS`. */
const dropIfStale = () => {
  if (latest === null) return;
  if (Date.now() - lastSampleAt <= STALE_AFTER_MS) return;
  latest = null;
  notify();
};

const poll = async () => {
  // A read already running will re-arm the loop itself when it finishes, so
  // bailing here can't strand it.
  if (inFlight || consumers === 0) return;
  inFlight = true;
  try {
    const res = await fetch('/api/training/sidecar/stats');
    if (res.ok) {
      const next = toStats((await res.json()) as StatsResponse);
      failures = 0;
      latest = next;
      lastSampleAt = Date.now();
      // Feeds the shared rolling buffer the sparklines draw from — every
      // consumer contributes to one timeline rather than each keeping its own.
      recordStatsSample(next, lastSampleAt);
      notify();
    } else {
      // Sidecar down (503) — keep the last sample while it's still current.
      failures += 1;
      dropIfStale();
    }
  } catch {
    failures += 1;
    dropIfStale();
  } finally {
    inFlight = false;
    schedule(
      failures === 0
        ? POLL_INTERVAL_MS
        : Math.min(FIRST_RETRY_MS * 2 ** (failures - 1), MAX_RETRY_MS),
    );
  }
};

/**
 * Browsers clamp timers hard in a hidden tab (a minute or more between
 * firings), which is the usual cause of a long dead stretch in the middle of
 * an otherwise continuous trace. Nothing can be done about the clamp, but a
 * tab coming back to the foreground can read immediately rather than waiting
 * out whatever throttled timeout is still pending.
 */
const handleVisibilityChange = () => {
  if (document.visibilityState !== 'visible' || consumers === 0) return;
  if (Date.now() - lastSampleAt < POLL_INTERVAL_MS) return;
  schedule(0);
};

const acquire = () => {
  consumers += 1;
  if (consumers > 1) return;
  document.addEventListener('visibilitychange', handleVisibilityChange);
  failures = 0;
  dropIfStale();
  void poll();
};

const release = () => {
  consumers -= 1;
  if (consumers > 0) return;
  clearTimer();
  document.removeEventListener('visibilitychange', handleVisibilityChange);
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => latest;
const getServerSnapshot = () => null;

/**
 * Keep the poller running while `enabled`, without subscribing to the
 * readings themselves.
 *
 * For callers that want the *history* filled rather than the current figures:
 * a live training run's load timeline has to be continuous whether or not the
 * surface that draws it happens to be open, otherwise closing the detail modal
 * for a minute punches a permanent hole in the run's graph.
 */
export const useStatsPolling = (enabled: boolean) => {
  useEffect(() => {
    if (!enabled) return;
    acquire();
    return release;
  }, [enabled]);
};

/**
 * Poll host CPU / memory / GPU load while `enabled`.
 *
 * Gated rather than always-on for the same reason the sidecar status poll is
 * (`use-sidecar-status`): nothing should be measuring the machine in the
 * background when no one is looking at the numbers. Returns null until the
 * first successful read, and keeps the last good sample through a transient
 * failure.
 */
export const useStats = (enabled: boolean) => {
  useStatsPolling(enabled);
  const stats = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // A disabled consumer reads nothing even when something else is polling —
  // its own gate is what decides whether these figures mean anything to it
  // (the history modal renders live boxes for an archived run otherwise).
  return enabled ? stats : null;
};
