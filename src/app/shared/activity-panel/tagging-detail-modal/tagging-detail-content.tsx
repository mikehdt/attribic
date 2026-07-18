import { ImageOffIcon } from 'lucide-react';

import type { TaggingImageError, TaggingJob } from '@/app/store/jobs';
import { getImageUrl } from '@/app/utils/image-utils';

import { ProgressBar } from '../../progress-bar/progress-bar';
import {
  deriveTaggingBar,
  deriveTaggingStatusLabel,
  formatDuration,
  formatPct,
  getTaggingPreloadPhase,
  isCaptionJob,
} from '../helpers';
import { Stat } from '../stat';
import { useElapsed } from './use-elapsed';

/**
 * The images the batch skipped, named rather than merely counted. Capped
 * because a bad model or a folder of corrupt files can fail every image in the
 * batch, and an unbounded list would push the stats off the screen.
 */
function ImageErrors({ errors }: { errors: TaggingImageError[] }) {
  if (errors.length === 0) return null;

  return (
    <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm dark:border-rose-800 dark:bg-rose-950">
      <p className="font-medium text-rose-700 dark:text-rose-200">
        {errors.length} {errors.length !== 1 ? 'errors' : 'error'} during batch
      </p>
      <ul className="mt-2 max-h-40 space-y-1.5 overflow-y-auto text-rose-700 dark:text-rose-200">
        {errors.slice(0, 20).map((err, i) => (
          <li key={`${err.fileId}-${i}`} className="wrap-break-word">
            <span className="font-mono text-sm opacity-70">{err.fileId}</span>
            <br />
            <span className="text-sm">{err.error}</span>
          </li>
        ))}
        {errors.length > 20 && (
          <li className="italic opacity-70">…and {errors.length - 20} more</li>
        )}
      </ul>
    </div>
  );
}

/**
 * The most recent image the batch finished, beside the caption (or tags) it
 * produced. This is the payoff of enlarging a caption job: the card can only
 * show a filename, so this is the one place you can actually watch what the
 * model is writing about your images as the batch runs.
 */
function LastResult({ job }: { job: TaggingJob }) {
  const result = job.lastResult;
  if (!result) return null;

  const src = result.fileName
    ? getImageUrl(result.fileName, job.projectFolderName)
    : null;
  const text = result.caption ?? result.tags?.join(', ') ?? '';

  return (
    <div className="flex gap-3">
      <div className="flex h-32 w-32 shrink-0 items-center justify-center overflow-hidden rounded border border-slate-300 bg-slate-100 dark:border-slate-600 dark:bg-slate-900">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- local file served straight off disk; the optimiser adds nothing for one throwaway preview
          <img
            src={src}
            alt={result.fileId}
            className="h-full w-full object-contain"
          />
        ) : (
          <ImageOffIcon className="h-6 w-6 text-slate-400" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="max-h-48 overflow-y-auto text-sm text-(--foreground)">
          {text || (
            <span className="text-slate-400">
              No text returned for this image
            </span>
          )}
        </p>
        <span className="truncate text-sm text-slate-400">
          Caption for {result.fileId}
        </span>
      </div>
    </div>
  );
}

/**
 * The body of a tagging/caption job's detail view: the latest captioned image,
 * overall progress, and per-stat figures. Rendered inside a `Modal` by the
 * activity panel's `TaggingDetailModal`. Reads nothing from Redux — the job is
 * passed in. The training equivalent shows loss and speed graphs here; a
 * caption batch has no such series, so the image itself takes that space.
 *
 * This is the only progress surface a batch has: starting one from the
 * auto-tagger modal hands straight over to this view, so it covers the whole
 * run — queued, loading, tagging, and the final summary.
 */
export function TaggingDetailContent({
  job,
  onCancel,
}: {
  job: TaggingJob | null;
  /** Absent for archived/terminal-only views; the button hides itself. */
  onCancel?: (job: TaggingJob) => void;
}) {
  // Ticks once a second while the batch runs; settles on the authoritative
  // span once completedAt lands. Called before the null guard — hooks can't
  // sit behind an early return.
  const elapsed = useElapsed(job?.startedAt ?? null, job?.completedAt ?? null);

  if (!job) return null;

  const { progress, summary } = job;
  const isRunning = job.status === 'running' || job.status === 'preparing';
  const isCompleted = job.status === 'completed';
  const isFailed = job.status === 'failed';
  const isCancelled = job.status === 'cancelled';
  const captioning = isCaptionJob(job);
  const preload = getTaggingPreloadPhase(job);
  const bar = deriveTaggingBar(job);

  const current = progress?.current ?? 0;
  const total = progress?.total ?? 0;
  const errorCount = summary?.errorCount ?? 0;
  const hasPartialErrors = isCompleted && errorCount > 0;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-medium text-(--foreground)">
          {job.projectName}
        </h2>
        <p className="text-xs text-slate-400">
          {captioning ? 'Caption' : 'Auto-tag'} · {job.modelName}
        </p>
      </div>

      <LastResult job={job} />

      <div className="flex flex-col gap-2">
        {isRunning && (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {preload === 'queued'
              ? 'Waiting for the GPU...'
              : preload === 'loading'
                ? 'Loading model...'
                : preload === 'starting'
                  ? `Starting auto-${captioning ? 'captioner' : 'tagger'}...`
                  : `${captioning ? 'Captioning' : 'Tagging'} image ${
                      // `current` counts images finished, so the one being
                      // worked on is the next — clamped so it can't overshoot.
                      total > 0 ? Math.min(current + 1, total) : 0
                    } of ${total}...`}
          </p>
        )}
        <ProgressBar
          value={bar.value}
          max={bar.max}
          size={isCompleted ? 'sm' : 'md'}
          color={
            hasPartialErrors
              ? 'amber'
              : isCompleted
                ? 'green'
                : isFailed || isCancelled
                  ? 'amber'
                  : 'indigo'
          }
          indeterminate={bar.indeterminate}
        />
        <span className="truncate text-sm text-slate-500">
          {deriveTaggingStatusLabel(job)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Progress"
          value={
            total > 0 ? (
              <>
                {current.toLocaleString()} / {total.toLocaleString()}
                <span className="ml-1.5 font-normal text-slate-400">
                  · {formatPct(current, total)}%
                </span>
              </>
            ) : (
              '—'
            )
          }
        />
        <Stat
          label={captioning ? 'Captioned' : 'Tagged'}
          value={summary ? summary.imagesWithNewTags.toLocaleString() : '—'}
        />
        <Stat
          label="Tags found"
          value={
            captioning
              ? null
              : summary
                ? summary.totalTagsFound.toLocaleString()
                : '—'
          }
        />
        <Stat
          label="Errors"
          value={errorCount > 0 ? String(errorCount) : '—'}
        />
        <Stat
          label="Elapsed"
          value={elapsed != null ? formatDuration(elapsed) : '—'}
        />
      </div>

      {summary?.errors && summary.errors.length > 0 && (
        <ImageErrors errors={summary.errors} />
      )}

      {isFailed && job.error && (
        <pre className="max-h-40 overflow-auto font-mono text-[11px] whitespace-pre-wrap text-rose-500">
          {job.error}
        </pre>
      )}
    </div>
  );
}
