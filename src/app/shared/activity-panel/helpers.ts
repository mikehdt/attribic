import type { TrainingProgress } from '@/app/services/training/types';

/** Format an ETA in seconds as a compact "1h 3m" / "4m 12s" / "45s". */
export function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Format a loss value with enough precision to be useful at typical LoRA loss magnitudes. */
export function formatLoss(loss: number): string {
  if (!Number.isFinite(loss)) return '—';
  return loss < 1 ? loss.toFixed(4) : loss.toFixed(2);
}

/**
 * Steps of warmup noise to hide from the training graphs. The first handful of
 * optimizer steps are settling noise — a large first-batch loss spike and an
 * unrepresentatively slow first few iterations (cold caches, lazy CUDA init) —
 * that squash the rest of the curve. Dropping them lets the meaningful part of
 * the run use the full plot range.
 */
export const SETTLE_STEPS = 16;

/**
 * Drop the leading settling-noise points from a step-indexed series so the
 * graph focuses on the representative part of the run. Falls back to the full
 * series while there aren't yet enough points past the window to plot a line —
 * so an early run still shows something rather than an empty chart.
 */
export function trimSettleSteps<T extends { step: number }>(
  points: T[],
  settle: number = SETTLE_STEPS,
): T[] {
  const trimmed = points.filter((p) => p.step > settle);
  return trimmed.length >= 2 ? trimmed : points;
}

/** Format a seconds-per-iteration value compactly for the speed graph. */
export function formatSecPerIt(secPerIt: number): string {
  if (!Number.isFinite(secPerIt)) return '—';
  if (secPerIt >= 100) return secPerIt.toFixed(0);
  if (secPerIt >= 10) return secPerIt.toFixed(1);
  return secPerIt.toFixed(2);
}

/**
 * Checkpoint count to display for a job. Prefers the trainer-confirmed
 * saved list; falls back to counting predicted positions already reached,
 * so older persisted data (and providers not yet reporting confirmed saves)
 * still show something sensible.
 */
export function deriveSavedCount(progress: TrainingProgress | null): number {
  if (!progress) return 0;
  const saved = progress.savedCheckpoints ?? [];
  if (saved.length > 0) return saved.length;
  const predicted = progress.checkpointSteps ?? [];
  return predicted.filter((s) => s <= progress.currentStep).length;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  // Decimal (1000-based) to match HuggingFace and every other download UI
  // the user is likely to compare against. Keeps row totals and variant
  // labels consistent — binary math would show 17.0 GB next to an 18.2 GB
  // HF file.
  const k = 1000;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    sizes.length - 1,
  );
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
