import type {
  TrainingProgress,
  TrainingProvider,
} from '@/app/services/training/types';
import type { TaggingJob } from '@/app/store/jobs';

/**
 * Whether a batch ran the VLM captioner rather than the ONNX tagger — decides
 * "captioned" vs "tagged" wording throughout. Both the job's own provider and
 * the summary's are checked so that jobs predating either field still read
 * correctly; failing those, a result carrying a caption gives it away.
 */
export function isCaptionJob(job: TaggingJob): boolean {
  const provider = job.providerType ?? job.summary?.providerType;
  if (provider) return provider === 'vlm';
  return job.lastResult?.caption != null;
}

/**
 * The phase a batch is in before it starts producing images, or null once it
 * is actually working through them. These are the steps the run spends most of
 * its opening minute in — waiting for the GPU, reading weights off disk, or
 * spinning up — and without them the UI shows an empty bar against the first
 * filename and reads as a stalled run.
 *
 * `starting` is the gap between creating the job and the backend's first event
 * of any kind: no queue placement, no loading shards, no progress.
 */
export function getTaggingPreloadPhase(
  job: TaggingJob,
): 'queued' | 'loading' | 'starting' | null {
  if (job.status !== 'running' && job.status !== 'preparing') return null;
  if (job.progress?.queued) return 'queued';
  if (job.progress?.loading) return 'loading';
  if (job.status === 'preparing') return 'starting';
  return null;
}

/**
 * Progress-bar geometry for a tagging job, shared by the activity card and the
 * detail view. During the preload phases the bar tracks model-loading shards
 * (or runs indeterminate when there's nothing countable yet) rather than the
 * image counter, which is stuck at zero until the first image lands.
 */
export function deriveTaggingBar(job: TaggingJob): {
  value: number;
  max: number;
  indeterminate: boolean;
} {
  const phase = getTaggingPreloadPhase(job);
  const loading = job.progress?.loading;
  if (phase === 'loading' && loading) {
    return {
      value: loading.current,
      max: loading.total || 1,
      indeterminate: loading.total === 0,
    };
  }
  if (phase) return { value: 0, max: 1, indeterminate: true };
  if (job.status === 'completed')
    return { value: 1, max: 1, indeterminate: false };

  const progress = job.progress;
  const isRunning = job.status === 'running' || job.status === 'preparing';
  return {
    value: progress?.current ?? 0,
    max: progress?.total || 1,
    indeterminate: isRunning && !progress,
  };
}

/**
 * The one-line status for a tagging job, shared by the activity card and the
 * detail view so the two can't drift. A completed batch may still have
 * per-image errors — that's reported as partial success rather than a clean
 * finish, since the images that failed were silently skipped.
 */
export function deriveTaggingStatusLabel(job: TaggingJob): string {
  const { progress, summary } = job;
  const errorCount = summary?.errorCount ?? 0;

  const phase = getTaggingPreloadPhase(job);
  if (phase === 'queued') {
    return `Queued for when GPU is free`;
  }
  if (phase === 'loading' && progress?.loading) {
    const { message, current, total } = progress.loading;
    return total > 0 ? `${message} (${current}/${total})` : message;
  }
  if (phase === 'starting') {
    return isCaptionJob(job) ? 'Loading captioner…' : 'Loading auto-tagger…';
  }
  if (job.status === 'running' || job.status === 'preparing') {
    return progress?.currentFileId || 'Processing...';
  }
  if (job.status === 'cancelled') return 'Cancelled';
  if (job.status === 'failed') return 'Failed';
  if (job.status !== 'completed' || !summary) return 'Done';

  const body = isCaptionJob(job)
    ? `Captioned ${summary.imagesWithNewTags} ${summary.imagesWithNewTags !== 1 ? 'images' : 'image'}`
    : `${summary.totalTagsFound} ${summary.totalTagsFound !== 1 ? 'tags' : 'tag'} across ${summary.imagesWithNewTags} ${summary.imagesWithNewTags !== 1 ? 'images' : 'image'}`;

  return errorCount > 0 ? `${body} (${errorCount} failed)` : body;
}

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
 * The wall-clock time an ETA lands on, as a compact "1:15pm". Computed from the
 * current moment each render, so it tracks the ETA as that updates.
 */
export function formatEtaClock(etaSeconds: number): string {
  const finish = new Date(Date.now() + etaSeconds * 1000);
  return finish
    .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    .replace(/\s?([AP])M/i, (_, p: string) => `${p.toLowerCase()}m`);
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
 * Split confirmed saves into those the trainer has since deleted and those
 * still on disk, given the run's rolling-save window (`maxSavesToKeep`, 0 =
 * keep all). Neither backend reports deletions, so this mirrors their pruning
 * rules — verified against both sources:
 *
 * Both write the end-of-run save WITHOUT the numeric suffix their pruner
 * matches on (sd-scripts `get_last_ckpt_name`; ai-toolkit's `{job_name}_*`
 * glob), so it is never swept and a keep-4 run ends with 5 files.
 *
 * Where they differ is the last step:
 * - sd-scripts skips the final epoch's numbered save outright
 *   (`train_network.py`: `... and (epoch + 1) < num_train_epochs`), so the
 *   last step carries the final save ALONE. It sits outside the window, and
 *   the window applies to the numbered saves before it.
 * - ai-toolkit has no such guard, so when the interval divides the run evenly
 *   the last step carries a numbered save AND the final save. That numbered
 *   save counts toward the window, and both files share one step — so the
 *   window applies to the whole set.
 *
 * Steps are the only granularity we have, so co-located files collapse to a
 * single entry. That's faithful: the line marks a step that still has a
 * checkpoint.
 */
export function splitPrunedCheckpoints({
  savedCheckpoints,
  maxSavesToKeep,
  provider,
  totalSteps,
  currentStep,
}: {
  savedCheckpoints: number[];
  maxSavesToKeep: number;
  provider?: TrainingProvider;
  totalSteps: number;
  currentStep: number;
}): { pruned: number[]; live: number[] } {
  if (maxSavesToKeep <= 0 || savedCheckpoints.length === 0) {
    return { pruned: [], live: savedCheckpoints };
  }

  // Only a finished run has written its exempt final save.
  const finalSaveWritten =
    totalSteps > 0 &&
    currentStep >= totalSteps &&
    savedCheckpoints[savedCheckpoints.length - 1] >= totalSteps;
  // ...and only sd-scripts leaves it alone at that step (see above). Unknown
  // providers take the plain last-N reading rather than inventing an exemption.
  const finalIsExempt = finalSaveWritten && provider === 'kohya';

  const windowed = finalIsExempt
    ? savedCheckpoints.slice(0, -1)
    : savedCheckpoints;
  const keptFrom = Math.max(0, windowed.length - maxSavesToKeep);

  return {
    pruned: windowed.slice(0, keptFrom),
    live: [
      ...windowed.slice(keptFrom),
      ...(finalIsExempt ? savedCheckpoints.slice(-1) : []),
    ],
  };
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
