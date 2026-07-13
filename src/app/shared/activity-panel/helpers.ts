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

/**
 * Progress through `max` as a percentage, to one decimal place. Training runs
 * are long enough that a whole-number percentage sits still for minutes at a
 * time and reads as a stalled run.
 */
export function formatPct(value: number, max: number): string {
  if (max <= 0) return '0.0';
  return (Math.min(1, value / max) * 100).toFixed(1);
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

/**
 * Total checkpoints a run is expected to produce, for the "saved / expected"
 * display. Counts the predicted intermediate save positions plus the final
 * LoRA every backend writes on completion. Deduped by step: a predicted save
 * that lands exactly on the last step is the same file as the final, and
 * confirmed saves are themselves step-deduped, so this converges to the final
 * `savedCount`. Returns 0 when there's no step count to base it on (so the
 * caller can fall back to a bare count).
 */
export function deriveExpectedCheckpointCount(
  progress: TrainingProgress | null,
): number {
  if (!progress) return 0;
  const total = progress.totalSteps ?? 0;
  if (total <= 0) return 0;
  const predicted = (progress.checkpointSteps ?? []).filter(
    (s) => s > 0 && s <= total,
  );
  // The final LoRA is always written at the last step; include it (deduped).
  return new Set([...predicted, total]).size;
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
