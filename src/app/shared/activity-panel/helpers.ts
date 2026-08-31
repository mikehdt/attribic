import { hasCapability } from '@/app/services/training/provider-capabilities';
import type {
  TrainingProgress,
  TrainingProvider,
} from '@/app/services/training/types';
import type { TaggingJob } from '@/app/store/jobs';

/**
 * Whether a batch produced captions rather than tags — decides "captioned" vs
 * "tagged" wording throughout. A VLM run in a tag-mode project produces tags
 * (`vlmOutput: 'tags'`), so the provider alone no longer decides; failing
 * every recorded field, a result carrying a caption gives it away.
 */
export function isCaptionJob(job: TaggingJob): boolean {
  if (job.vlmOutput === 'tags') return false;
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

const TQDM_RE = /(\d+)\/(\d+)\s+\[/;

/**
 * Turn the most recent sidecar log lines into a short, readable phase label so
 * the activity card can show "Caching latents (3/4)" instead of a raw tqdm
 * string or a silent "Preparing…". Walks backwards through the log tail to pick
 * up the latest progress bar, classifying it from nearby context when the bar
 * itself has no prefix.
 *
 * Shared by the activity card and the detail modal so both name the same phase
 * for the same run — the modal is the card enlarged, not a second opinion.
 */
export function derivePreparingPhase(
  lines: string[] | undefined,
): string | null {
  if (!lines || lines.length === 0) return null;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const tqdm = line.match(TQDM_RE);
    if (tqdm) {
      const counter = `${tqdm[1]}/${tqdm[2]}`;
      const context = [line, ...lines.slice(Math.max(0, i - 5), i)]
        .join(' ')
        .toLowerCase();
      if (/cach.*latent/.test(context)) return `Caching latents (${counter})`;
      if (/text.*(encod|embed)|cach.*text/.test(context))
        return `Encoding text (${counter})`;
      return `Processing (${counter})`;
    }

    const l = line.toLowerCase();
    // Sidecar-emitted setup phases (before the training backend starts).
    if (/starting.*(ai-toolkit|server)/.test(l)) return 'Starting backend';
    if (/server ready/.test(l)) return 'Backend ready';
    if (/submitting/.test(l)) return 'Submitting job';
    if (/job created/.test(l)) return 'Job created';
    if (/waiting.*worker/.test(l)) return 'Waiting for worker';
    // Training backend phases.
    if (/load.*(model|transformer|pipeline)/.test(l)) return 'Loading model';
    if (/quantiz/.test(l)) return 'Quantizing';
    if (/cach.*latent/.test(l)) return 'Caching latents';
    if (/text.*(encod|embed)/.test(l)) return 'Encoding text';
    if (/start.*train|begin.*train/.test(l)) return 'Starting training';
  }

  return null;
}

/**
 * The phase label without the "(3/4)" {@link derivePreparingPhase} appends, for
 * the readouts that print the counts themselves — otherwise the same numbers
 * land on the row twice.
 */
export function stripPhaseCounter(phase: string): string {
  return phase.replace(/\s*\(\d+\/\d+\)$/, '');
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
const SETTLE_STEPS = 16;

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
  // ...and only sd-scripts-lineage backends leave it alone at that step (see
  // above). Unknown providers take the plain last-N reading rather than
  // inventing an exemption.
  const finalIsExempt =
    finalSaveWritten &&
    provider !== undefined &&
    hasCapability(provider, 'finalSaveExempt');

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

/**
 * Count of distinct sampling events that have produced at least one image,
 * grouped the same way as the samples grid's rows (by epoch for epoch-cadence
 * runs, by step otherwise) so the "x / y" stat matches the table.
 */
export function deriveSampleEventCount(
  progress: TrainingProgress | null,
): number {
  const samples = progress?.samples ?? [];
  if (samples.length === 0) return 0;
  const events = new Set<string>();
  for (const s of samples) {
    events.add(s.epoch != null ? `e${s.epoch}` : `s${s.step}`);
  }
  return events.size;
}

/**
 * Distinct steps that have produced sample images, ascending — the x positions
 * of the loss chart's solid sample markers.
 *
 * Epoch-cadence runs (Kohya) encode the epoch in the filename and leave step at
 * 0, so those are mapped onto the step axis with the same ceil-based
 * steps-per-epoch math the chart's epoch gridlines use. Without a step count to
 * convert against they're dropped rather than piled up on the y-axis.
 */
export function deriveSampleImageSteps(
  progress: TrainingProgress | null,
): number[] {
  const samples = progress?.samples ?? [];
  if (samples.length === 0) return [];

  const totalSteps = progress?.totalSteps ?? 0;
  const totalEpochs = progress?.totalEpochs ?? 0;
  const stepsPerEpoch =
    totalSteps > 0 && totalEpochs > 0
      ? Math.max(1, Math.ceil(totalSteps / totalEpochs))
      : 0;

  const steps = new Set<number>();
  for (const sample of samples) {
    if (sample.epoch == null) {
      steps.add(sample.step);
    } else if (stepsPerEpoch > 0) {
      steps.add(Math.min(sample.epoch * stepsPerEpoch, totalSteps));
    }
  }
  return [...steps].sort((a, b) => a - b);
}

/**
 * Whether a phase label reports the trainer generating sample/preview images
 * between training steps. The two backends word it differently — Kohya emits
 * "Generating samples", ai-toolkit "Generating images - x/y" — so match both,
 * and let callers give the phase its own distinct treatment.
 */
export function isSamplingPhase(phase: string | null | undefined): boolean {
  if (!phase) return false;
  return /generating\s+(sample|image)/i.test(phase);
}

/**
 * The "x/y" image count both backends append to their sampling phase label —
 * ai-toolkit's "Generating images - 3/4", Kohya's "Generating samples - 3/4"
 * (which the sidecar counts itself, off the per-image `prompt:` block
 * sd-scripts echoes, since sd-scripts never states the count).
 */
const SAMPLING_COUNT_PATTERN = /(\d+)\s*\/\s*(\d+)/;

/**
 * A consistent label for the sampling phase, so ai-toolkit's "Generating
 * images - 3/4" reads the same as Kohya's "Generating samples - 3/4" while
 * keeping the count. Deliberately the same word the samples grid stamps on the
 * event in flight, so the Phase stat and the grid row read as the one thing
 * happening.
 */
export function formatSamplingLabel(phase: string): string {
  const count = SAMPLING_COUNT_PATTERN.exec(phase);
  return count ? `Generating ${count[1]}/${count[2]}` : 'Generating';
}

/**
 * Which prompt column the trainer is rendering into right now (0-based), read
 * off that same count. Null when the label carries none — the event hasn't
 * announced its first image yet, or the backend never reported one.
 *
 * Worth preferring over "the leftmost empty cell": images land one prompt at a
 * time in order, so the gap is the obvious guess, but a finished image stays
 * unclaimed until it settles on disk — long enough that the next image's bar
 * would draw in the finished image's cell, one cell appearing to generate
 * twice. The counted index doesn't lag behind the filesystem.
 */
export function samplingImageIndex(
  phase: string | null | undefined,
): number | null {
  if (!phase) return null;
  const count = SAMPLING_COUNT_PATTERN.exec(phase);
  if (!count) return null;
  const index = Number(count[1]) - 1;
  return index >= 0 ? index : null;
}

/**
 * Per-step seconds implied by the headline ETA, for derived hints (next save /
 * epoch / sample) — so they stay coherent with it (always ≤ full ETA, no
 * jitter against it) rather than tracking the noisier instantaneous speed.
 * Null while pending/preparing, when the step counters belong to a setup
 * phase rather than training, or when there's no usable ETA.
 */
export function deriveSecPerStep(
  progress: TrainingProgress | null,
): number | null {
  if (!progress) return null;
  if (progress.status === 'pending' || progress.status === 'preparing') {
    return null;
  }
  const total = progress.totalSteps ?? 0;
  const current = progress.currentStep ?? 0;
  if (total <= 0 || current >= total) return null;
  if (progress.etaSeconds === null || progress.etaSeconds <= 0) return null;
  return progress.etaSeconds / (total - current);
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

/**
 * A transfer rate as "8.4 MB/s". Sub-megabyte rates get no decimal — a link
 * doing 340 KB/s doesn't hold a tenth of a kilobyte steady long enough for the
 * digit to be anything but noise.
 */
export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond >= 1000 * 1000) {
    return `${(bytesPerSecond / (1000 * 1000)).toFixed(1)} MB/s`;
  }
  return `${Math.round(bytesPerSecond / 1000)} KB/s`;
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
