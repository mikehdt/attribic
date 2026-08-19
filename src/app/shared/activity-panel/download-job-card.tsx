import { DownloadIcon, RefreshCwIcon, Trash2Icon, XIcon } from 'lucide-react';
import { useCallback } from 'react';

import { useConfirmAction } from '@/app/shared/use-confirm-action';
import { useAppDispatch } from '@/app/store/hooks';
import { type DownloadJob } from '@/app/store/jobs';
import { clearDownload } from '@/app/store/jobs/download-runtime';

import { ProgressBar } from '../progress-bar/progress-bar';
import { ActionButton } from './action-button';
import { formatBytes, formatEta, formatSpeed } from './helpers';

// Past this the estimate is being driven by a rate that's collapsed to nearly
// nothing, and "18h left" is more alarming than informative.
const MAX_USEFUL_ETA_SECONDS = 24 * 60 * 60;

export function DownloadJobCard({
  job,
  onRetry,
  onCancel,
  onDelete,
}: {
  job: DownloadJob;
  onRetry?: (job: DownloadJob) => void;
  onCancel?: (job: DownloadJob) => void;
  onDelete?: (job: DownloadJob) => void;
}) {
  const dispatch = useAppDispatch();

  // Cancel is a two-step confirm — it sits in the tight header row, so a
  // stray click shouldn't throw away a part-finished multi-gigabyte download.
  const handleConfirmCancel = useCallback(() => {
    onCancel?.(job);
  }, [onCancel, job]);
  const { armed: confirmingCancel, trigger: handleCancelClick } =
    useConfirmAction(handleConfirmCancel);

  const isRunning = job.status === 'running';
  const isCompleted = job.status === 'completed';
  const isFailed = job.status === 'failed';
  const isInterrupted = job.status === 'interrupted';
  const isCancelled = job.status === 'cancelled';
  const canRetry = isFailed || isInterrupted || isCancelled;
  const isDone = !isRunning;

  const iconColour = isRunning
    ? 'text-indigo-500'
    : isCompleted
      ? 'text-green-500'
      : isFailed || isInterrupted
        ? 'text-amber-500'
        : 'text-slate-400';

  const currentFileLabel = job.progress?.currentFile || 'Preparing...';
  const multiFile =
    job.progress?.totalFiles !== undefined && job.progress.totalFiles > 1;
  const fileCountLabel = multiFile
    ? `File ${job.progress?.fileIndex ?? 1} of ${job.progress?.totalFiles}`
    : null;

  // Both are measured by the sidecar, so they're absent for the first moment of
  // a transfer and after it settles — hence the per-part guards rather than one
  // check on `progress`.
  const speed = job.progress?.speedBps;
  const eta = job.progress?.etaSeconds;
  const rateLabel = [
    speed !== undefined && speed > 0 ? formatSpeed(speed) : null,
    eta !== undefined && eta > 0 && eta < MAX_USEFUL_ETA_SECONDS
      ? `${formatEta(Math.round(eta))} left`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const statusLabel = isInterrupted
    ? 'Interrupted'
    : isCancelled
      ? 'Cancelled'
      : isFailed
        ? 'Failed'
        : isCompleted
          ? 'Done'
          : currentFileLabel;

  return (
    <div className="border-b border-(--border-subtle) px-3 py-2.5 last:border-b-0">
      {/* Header */}
      <div className="flex items-center gap-2">
        <DownloadIcon className={`h-3.5 w-3.5 shrink-0 ${iconColour}`} />
        <span className="truncate text-xs font-medium text-(--foreground)">
          {job.modelName}
        </span>
        {isRunning && onCancel && (
          <div className="ml-auto flex shrink-0 items-center">
            <ActionButton
              onClick={handleCancelClick}
              title={
                confirmingCancel
                  ? 'Click again to confirm cancellation'
                  : 'Cancel download'
              }
              variant="danger"
            >
              <XIcon className="h-2.5 w-2.5" />
              {confirmingCancel ? 'Confirm?' : 'Cancel'}
            </ActionButton>
          </div>
        )}
      </div>

      {/* Progress bar */}
      {(isRunning || isCompleted || canRetry) && (
        <div className="mt-2">
          <ProgressBar
            value={isCompleted ? 1 : (job.progress?.bytesDownloaded ?? 0)}
            max={isCompleted ? 1 : (job.progress?.totalBytes ?? 1)}
            size="xs"
            color={isCompleted ? 'green' : canRetry ? 'amber' : 'indigo'}
            indeterminate={isRunning && !job.progress}
            className="mb-1"
          />
          {isRunning && (fileCountLabel || rateLabel) && (
            <div className="flex justify-between gap-2 text-xs text-slate-400 tabular-nums">
              <span className="truncate">{fileCountLabel}</span>
              <span className="shrink-0 text-right">{rateLabel}</span>
            </div>
          )}
          <div className="flex justify-between text-xs text-slate-500 tabular-nums">
            <span className="truncate">{statusLabel}</span>
            <span className="shrink-0 pl-2 text-right">
              {job.progress
                ? `${formatBytes(job.progress.bytesDownloaded)} / ${formatBytes(job.progress.totalBytes)}`
                : ''}
            </span>
          </div>
        </div>
      )}

      {isFailed && job.error && (
        <p className="mt-1 text-xs text-red-500">{job.error}</p>
      )}

      {/* Actions — running jobs carry their only action (Cancel) in the
          header, so this row is for finished/failed jobs. */}
      {isDone && (
        <div className="mt-1.5 flex items-center justify-end gap-1">
          {canRetry && onRetry && (
            <ActionButton onClick={() => onRetry(job)} title="Retry download">
              <RefreshCwIcon className="h-2.5 w-2.5" />
              Retry
            </ActionButton>
          )}
          {canRetry && onDelete && (
            <ActionButton
              onClick={() => onDelete(job)}
              title="Delete partial files and remove"
              variant="danger"
            >
              <Trash2Icon className="h-2.5 w-2.5" />
              Delete
            </ActionButton>
          )}
          <div className="mr-auto" />
          <ActionButton
            onClick={() => void dispatch(clearDownload(job.id))}
            title="Clear from list"
          >
            <XIcon className="h-2.5 w-2.5" />
            Clear
          </ActionButton>
        </div>
      )}
    </div>
  );
}
