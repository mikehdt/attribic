'use client';

import { useCallback, useEffect, useState } from 'react';

import { recordStatsSample } from './history';

/** One GPU's current load. Every figure is optional — nvidia-smi answers
 * `[N/A]` for anything a given card or driver doesn't expose. */
export type GpuStats = {
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

/**
 * Poll host CPU / memory / GPU load while `enabled`.
 *
 * Gated rather than always-on for the same reason the sidecar status poll is
 * (`use-sidecar-status`): nothing should be measuring the machine in the
 * background when no one is looking at the numbers. Returns null until the
 * first successful read, and keeps the last good sample through a transient
 * failure — a stats row that blinks out mid-run reads as a fault that isn't one.
 */
export const useStats = (enabled: boolean) => {
  const [stats, setStats] = useState<SystemStats | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/training/sidecar/stats');
      if (!res.ok) return; // sidecar down (503) — keep the last sample
      const next = toStats((await res.json()) as StatsResponse);
      setStats(next);
      // Feeds the shared rolling buffer the sparklines draw from — every
      // consumer contributes to one timeline rather than each keeping its own.
      recordStatsSample(next);
    } catch {
      // Transient — keep the last known figures.
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async poll; setState runs after the fetch resolves
    refresh();
    const id = window.setInterval(refresh, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [enabled, refresh]);

  return stats;
};
