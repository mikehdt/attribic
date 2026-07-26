'use client';

import { formatMemory, formatPercent, formatTemperature } from './format';
import { useStats } from './use-stats';

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <span>
      {label}{' '}
      <span className="font-medium text-(--foreground)">{value}</span>
    </span>
  );
}

/**
 * Host CPU / GPU / VRAM load, polled while `enabled`.
 *
 * These are **machine-wide** figures, not this job's — the GPU numbers include
 * anything else on the card, and the queue shares one GPU between training and
 * captioning. Placed next to a run for the "is it actually working, and how
 * close to the VRAM ceiling" read, not as an attribution of usage.
 *
 * System RAM and the GPU's name/temperature ride in the tooltip rather than the
 * row, which has to stay legible in a 264px-wide activity card.
 */
export function Stats({ enabled = true }: { enabled?: boolean }) {
  const stats = useStats(enabled);
  if (!stats) return null;

  const gpu = stats.gpus[0] ?? null;

  const tooltip = [
    'System-wide load',
    stats.memoryUsedMb != null &&
      `RAM ${formatMemory(stats.memoryUsedMb, stats.memoryTotalMb)}`,
    gpu?.name,
    gpu?.temperatureC != null && formatTemperature(gpu.temperatureC),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      className="flex justify-between gap-2 text-xs text-slate-400 tabular-nums"
      title={tooltip}
    >
      <StatItem label="CPU" value={formatPercent(stats.cpuPercent)} />
      {gpu ? (
        <>
          <StatItem label="GPU" value={formatPercent(gpu.utilization)} />
          <StatItem
            label="VRAM"
            value={formatMemory(gpu.memoryUsedMb, gpu.memoryTotalMb)}
          />
        </>
      ) : (
        <StatItem
          label="RAM"
          value={formatMemory(stats.memoryUsedMb, stats.memoryTotalMb)}
        />
      )}
    </div>
  );
}
