'use client';

import { ActivityIcon, ChevronDownIcon } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { memo, useCallback, useEffect, useRef } from 'react';

import { cancelTaggingJob } from '@/app/services/auto-tagger/tagging-controllers';
import { useIsAnyModalOpen } from '@/app/shared/modal';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import {
  cancelTagging,
  clearCompletedJobs,
  closePanel,
  openPanel,
  restoreJobs,
  selectActiveJobs,
  selectCompletedJobs,
  selectHasJobs,
  selectPanelOpen,
  selectPendingJobs,
  type TaggingJob,
  updateJobStatus,
} from '@/app/store/jobs';
import {
  loadPersistedDownloads,
  loadPersistedTrainingJobs,
  reconcileDownloadsWithServer,
} from '@/app/store/jobs/persistence';

import { Button } from '../button';
import { DownloadJobCard } from './download-job-card';
import { PendingJobsList } from './pending-jobs-list';
import { TaggingJobCard } from './tagging-job-card';
import { TrainingJobCard } from './training-job-card';
import { useDownloadActions } from './use-download-actions';

const ActivityPanelComponent = () => {
  const dispatch = useAppDispatch();
  const pathname = usePathname();
  const isAnyModalOpen = useIsAnyModalOpen();
  const panelOpen = useAppSelector(selectPanelOpen);
  const hasJobs = useAppSelector(selectHasJobs);
  const activeJobs = useAppSelector(selectActiveJobs);
  const pendingJobs = useAppSelector(selectPendingJobs);
  const completedJobs = useAppSelector(selectCompletedJobs);

  // Push up above the bottom shelf on views that have one
  const hasBottomShelf =
    pathname.startsWith('/tagging') || pathname.startsWith('/training');
  const bottomClass = hasBottomShelf ? 'bottom-16' : 'bottom-4';

  // Restore persisted downloads and terminal training jobs on mount.
  // Downloads that were `running` when the page closed are restored as-is,
  // then reconciled against the server's active-download set: another tab
  // may still own the stream, in which case we leave the job alone. Only
  // jobs the server no longer tracks get flipped to `interrupted`.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    const downloads = loadPersistedDownloads();
    const training = loadPersistedTrainingJobs();
    const persisted = [...downloads, ...training];
    if (persisted.length === 0) return;

    dispatch(restoreJobs(persisted));
    if (downloads.some((j) => j.status === 'interrupted')) {
      dispatch(openPanel());
    }

    void reconcileDownloadsWithServer(downloads).then((staleIds) => {
      if (staleIds.length === 0) return;
      for (const id of staleIds) {
        dispatch(
          updateJobStatus({
            id,
            status: 'interrupted',
            error: 'Download interrupted — click Retry to continue',
          }),
        );
      }
      dispatch(openPanel());
    });
  }, [dispatch]);

  const handleOpen = useCallback(() => {
    dispatch(openPanel());
  }, [dispatch]);

  const handleClose = useCallback(() => {
    dispatch(closePanel());
  }, [dispatch]);

  const {
    retry: handleRetryDownload,
    cancel: handleCancelDownload,
    remove: handleDeleteDownload,
  } = useDownloadActions();

  const handleCancelTagging = useCallback(
    (job: TaggingJob) => {
      cancelTaggingJob(job.id);
      dispatch(cancelTagging(job.id));
    },
    [dispatch],
  );

  const handleClearAll = useCallback(() => {
    dispatch(clearCompletedJobs());
    // Tell the sidecar to drop any terminal active_job too, so a refresh
    // doesn't re-hydrate one we just cleared. The endpoint is a no-op when
    // the sidecar isn't running or has nothing to clear.
    fetch('/api/training/clear', { method: 'POST' }).catch(() => {});
  }, [dispatch]);

  if (!hasJobs || isAnyModalOpen) return null;

  const activeCount = activeJobs.length;
  const hasActive = activeCount > 0;
  const hasClearable = completedJobs.length > 0;

  // Minimised: floating icon button
  if (!panelOpen) {
    return (
      <button
        type="button"
        onClick={handleOpen}
        className={`fixed right-4 ${bottomClass} z-50 flex cursor-pointer items-center justify-center rounded-full border border-(--border-subtle) bg-(--surface) p-2.5 shadow-lg shadow-slate-800/20 transition-colors hover:bg-(--surface-hover)`}
        title="Show activity"
      >
        <ActivityIcon
          className={`h-4.5 w-4.5 ${hasActive ? 'text-sky-500' : 'text-(--foreground)/50'}`}
        />
        {hasActive && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-sky-500 px-1 text-xs font-bold text-white">
            {activeCount}
          </span>
        )}
      </button>
    );
  }

  // Expanded: full panel
  return (
    <div
      className={`fixed right-4 ${bottomClass} z-50 w-80 overflow-hidden rounded-lg border border-slate-300 bg-(--surface) shadow-lg shadow-slate-800/20 dark:border-slate-600`}
    >
      {/* Panel header */}
      <div className="flex items-center justify-between border-b border-(--border-subtle) bg-slate-200 px-3 py-2 inset-shadow-sm inset-shadow-white dark:bg-slate-700 dark:inset-shadow-slate-600">
        <span className="text-sm text-(--foreground)">
          Activity
          {hasActive && (
            <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-sky-500 px-1 text-xs font-bold text-white">
              {activeCount}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={handleClose}
          className="cursor-pointer rounded p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          title="Minimise"
        >
          <ChevronDownIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Jobs list */}
      <div className="max-h-96 overflow-y-auto">
        {/* Pending jobs */}
        {pendingJobs.length > 0 && <PendingJobsList jobs={pendingJobs} />}

        {/* Active jobs */}
        {activeJobs.map((job) =>
          job.type === 'training' ? (
            <TrainingJobCard key={job.id} job={job} />
          ) : job.type === 'tagging' ? (
            <TaggingJobCard
              key={job.id}
              job={job}
              onCancel={handleCancelTagging}
            />
          ) : (
            <DownloadJobCard
              key={job.id}
              job={job}
              onRetry={handleRetryDownload}
              onCancel={handleCancelDownload}
              onDelete={handleDeleteDownload}
            />
          ),
        )}

        {/* Completed/failed/interrupted jobs */}
        {completedJobs.map((job) =>
          job.type === 'training' ? (
            <TrainingJobCard key={job.id} job={job} />
          ) : job.type === 'tagging' ? (
            <TaggingJobCard key={job.id} job={job} />
          ) : (
            <DownloadJobCard
              key={job.id}
              job={job}
              onRetry={handleRetryDownload}
              onCancel={handleCancelDownload}
              onDelete={handleDeleteDownload}
            />
          ),
        )}
      </div>

      {/* Footer with Clear All */}
      {hasClearable && (
        <div className="flex justify-end border-t border-(--border-subtle) px-3 py-1.5">
          <Button onClick={handleClearAll} size="xs" width="md" variant="ghost">
            Clear all
          </Button>
        </div>
      )}
    </div>
  );
};

export const ActivityPanel = memo(ActivityPanelComponent);
