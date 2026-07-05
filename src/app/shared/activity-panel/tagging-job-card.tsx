import { ExternalLinkIcon, ScanSearchIcon, XIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useAppDispatch } from '@/app/store/hooks';
import { removeJob, type TaggingJob } from '@/app/store/jobs';

import { ProgressBar } from '../progress-bar/progress-bar';
import { ActionButton } from './action-button';

export function TaggingJobCard({
  job,
  onCancel,
}: {
  job: TaggingJob;
  onCancel?: (job: TaggingJob) => void;
}) {
  const dispatch = useAppDispatch();
  const pathname = usePathname();

  // Only show the link when the user isn't already viewing this project's tagging page
  const projectHref = `/tagging/${encodeURIComponent(job.projectFolderName)}/1`;
  const isOnProjectPage = pathname.startsWith(
    `/tagging/${encodeURIComponent(job.projectFolderName)}`,
  );

  const isRunning = job.status === 'running' || job.status === 'preparing';
  const isCompleted = job.status === 'completed';
  const isFailed = job.status === 'failed';
  const isCancelled = job.status === 'cancelled';
  const isDone = !isRunning;

  const progress = job.progress;
  const summary = job.summary;

  // A completed batch may still have per-image errors — treat it as partial
  // success so the card colour and status text reflect what actually happened.
  const errorCount = summary?.errorCount ?? 0;
  const hasPartialErrors = isCompleted && errorCount > 0;
  const isCaptioning = summary?.providerType === 'vlm';

  const pct =
    progress && progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;

  const iconColour = isRunning
    ? 'text-indigo-500'
    : hasPartialErrors
      ? 'text-amber-500'
      : isCompleted
        ? 'text-green-500'
        : isFailed
          ? 'text-red-500'
          : 'text-slate-400';

  // Build the completion line. For VLM captioning there's no "tag count", so
  // we say "Captioned N images"; for tagging we keep the historic wording.
  const successBody =
    isCompleted && summary
      ? isCaptioning
        ? `Captioned ${summary.imagesWithNewTags} image${summary.imagesWithNewTags !== 1 ? 's' : ''}`
        : `${summary.totalTagsFound} tag${summary.totalTagsFound !== 1 ? 's' : ''} across ${summary.imagesWithNewTags} image${summary.imagesWithNewTags !== 1 ? 's' : ''}`
      : 'Done';

  const statusLabel = isRunning
    ? progress?.queued
      ? `Queued — position ${progress.queued.position}`
      : progress?.loading
        ? progress.loading.message
        : progress?.currentFileId || 'Processing...'
    : isCancelled
      ? 'Cancelled'
      : isFailed
        ? 'Failed'
        : hasPartialErrors
          ? `${successBody} (${errorCount} failed)`
          : isCompleted
            ? successBody
            : 'Done';

  return (
    <div className="border-b border-(--border-subtle) px-3 py-2.5 last:border-b-0">
      {/* Header */}
      <div className="flex items-center gap-2">
        <ScanSearchIcon className={`h-3.5 w-3.5 shrink-0 ${iconColour}`} />
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {isOnProjectPage ? (
            <span className="truncate text-xs font-medium text-(--foreground)">
              {job.projectName}
            </span>
          ) : (
            <Link
              href={projectHref}
              className="group flex min-w-0 items-center gap-1 truncate text-xs font-medium text-(--foreground) hover:text-sky-500"
              title={`Open project: ${job.projectName}`}
            >
              <span className="truncate">{job.projectName}</span>
              <ExternalLinkIcon className="h-2.5 w-2.5 shrink-0 text-slate-400 group-hover:text-sky-500" />
            </Link>
          )}
          <span className="shrink-0 text-xs text-slate-400">
            · {job.modelName}
          </span>
        </div>
      </div>

      {/* Progress */}
      <div className="mt-2">
        <ProgressBar
          value={isCompleted ? 1 : (progress?.current ?? 0)}
          max={isCompleted ? 1 : (progress?.total ?? 1)}
          size="xs"
          color={
            hasPartialErrors
              ? 'amber'
              : isCompleted
                ? 'green'
                : isFailed || isCancelled
                  ? 'amber'
                  : 'indigo'
          }
          indeterminate={
            isRunning && (!progress || !!progress.queued || !!progress.loading)
          }
          className="mb-1"
        />
        <div className="flex justify-between text-xs text-slate-500 tabular-nums">
          <span className="truncate">{statusLabel}</span>
          {isRunning && progress && (
            <span className="shrink-0 pl-2 text-right">
              {progress.current} / {progress.total} · {pct}%
            </span>
          )}
        </div>
      </div>

      {isFailed && job.error && (
        <p className="mt-1 text-xs text-red-500">{job.error}</p>
      )}

      {/* Actions */}
      <div className="mt-1.5 flex items-center gap-1">
        {isRunning && onCancel && (
          <ActionButton
            onClick={() => onCancel(job)}
            title="Cancel tagging"
            variant="danger"
          >
            <XIcon className="h-2.5 w-2.5" />
            Cancel
          </ActionButton>
        )}
        {isDone && (
          <>
            <div className="mr-auto" />
            <ActionButton
              onClick={() => dispatch(removeJob(job.id))}
              title="Clear from list"
            >
              <XIcon className="h-2.5 w-2.5" />
              Clear
            </ActionButton>
          </>
        )}
      </div>
    </div>
  );
}
