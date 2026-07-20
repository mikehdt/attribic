'use client';

import { ActivityIcon, ChevronDownIcon, XIcon } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { memo, useCallback, useEffect, useRef } from 'react';

import { cancelTaggingJob } from '@/app/services/auto-tagger/tagging-controllers';
import { useIsAnyModalOpen } from '@/app/shared/modal';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import {
  cancelTagging,
  clearCompletedJobs,
  closeJobDetail,
  closePanel,
  openJobDetail,
  openPanel,
  restoreJobs,
  selectActiveJobs,
  selectCompletedJobs,
  selectDetailJob,
  selectHasJobs,
  selectPanelOpen,
  selectPendingJobs,
  type TaggingJob,
  updateJobStatus,
} from '@/app/store/jobs';
import {
  loadPersistedDownloads,
  reconcileDownloadsWithServer,
} from '@/app/store/jobs/persistence';
import {
  dismissAllFromPanel,
  restoreHistory,
} from '@/app/store/training-history';
import { loadPersistedTrainingHistory } from '@/app/store/training-history/persistence';

import { Button } from '../button';
import { DownloadJobCard } from './download-job-card';
import { PendingJobsList } from './pending-jobs-list';
import { TaggingDetailModal } from './tagging-detail-modal/tagging-detail-modal';
import { TaggingJobCard } from './tagging-job-card';
import { TrainingDetailModal } from './training-detail-modal/training-detail-modal';
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

    // Seed the durable history archive first, before any newly-terminal run
    // this session gets recorded (which persists the whole slice) — otherwise
    // an unrestored slice would overwrite the stored archive with just the
    // current session's runs.
    const history = loadPersistedTrainingHistory();
    if (history.length > 0) dispatch(restoreHistory(history));

    // The history archive is the single persisted home for terminal training
    // runs, so seed the activity panel's terminal-training rows from it,
    // skipping any the user previously cleared. The panel-only
    // `dismissedFromPanel` flag rides along inertly — the jobs slice never
    // reads or persists it.
    const downloads = loadPersistedDownloads();
    const training = history.filter((entry) => !entry.dismissedFromPanel);
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
    // Terminal training runs live in the durable history archive, not the jobs
    // slice's persistence. Mark them dismissed so they stay out of the panel
    // across refreshes (they remain in the Run History view).
    dispatch(dismissAllFromPanel());
    // Tell the sidecar to drop any terminal active_job too, so a refresh
    // doesn't re-hydrate one we just cleared. The endpoint is a no-op when
    // the sidecar isn't running or has nothing to clear.
    fetch('/api/training/clear', { method: 'POST' }).catch(() => {});
  }, [dispatch]);

  // Which job's enlarge modal is open, if any. Rendered here — above the
  // `isAnyModalOpen` gate below — rather than inside a job card: the panel
  // (and every card in it) unmounts while a modal is open, so a modal
  // rendered *inside* a card would unmount itself the instant it opened.
  //
  // The state itself lives in the jobs slice because the auto-tagger modal
  // opens the tagging detail view directly when a batch starts. Both modals
  // close themselves when their id no longer resolves, so handing a tagging id
  // to the training modal would make it slam shut on open — hence the type.
  const detail = useAppSelector(selectDetailJob);
  const handleEnlargeTraining = useCallback(
    (id: string) => {
      dispatch(openJobDetail({ id, type: 'training' }));
    },
    [dispatch],
  );
  const handleEnlargeTagging = useCallback(
    (id: string) => {
      dispatch(openJobDetail({ id, type: 'tagging' }));
    },
    [dispatch],
  );
  const handleCloseDetail = useCallback(() => {
    dispatch(closeJobDetail());
  }, [dispatch]);

  const activeCount = activeJobs.length;
  const hasActive = activeCount > 0;
  const hasClearable = completedJobs.length > 0;

  // The open panel renders whenever `panelOpen` is set, jobs or not — an empty
  // panel is the honest answer to "show me the queue" when nothing is running.
  // Gating it on `hasJobs` made the toggle a silent no-op while idle. Only the
  // minimised bubble is gated: an ambient indicator with nothing to indicate is
  // just clutter.
  const panelContent = isAnyModalOpen ? null : !panelOpen ? (
    hasJobs && (
      // Minimised: floating icon button
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
    )
  ) : (
    // Expanded: full panel
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
          title={!hasJobs ? 'Close' : 'Minimise'}
        >
          {!hasJobs ? (
            <XIcon className="h-3.5 w-3.5" />
          ) : (
            <ChevronDownIcon className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Jobs list */}
      <div className="max-h-96 overflow-y-auto">
        {!hasJobs && (
          <p className="px-3 py-6 text-center text-sm text-(--foreground)/50">
            No jobs are currently running. Training runs, tagging batches and
            model downloads appear here.
          </p>
        )}

        {/* Pending jobs */}
        {pendingJobs.length > 0 && <PendingJobsList jobs={pendingJobs} />}

        {/* Active jobs */}
        {activeJobs.map((job) =>
          job.type === 'training' ? (
            <TrainingJobCard
              key={job.id}
              job={job}
              onEnlarge={handleEnlargeTraining}
            />
          ) : job.type === 'tagging' ? (
            <TaggingJobCard
              key={job.id}
              job={job}
              onCancel={handleCancelTagging}
              onEnlarge={handleEnlargeTagging}
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
            <TrainingJobCard
              key={job.id}
              job={job}
              onEnlarge={handleEnlargeTraining}
            />
          ) : job.type === 'tagging' ? (
            <TaggingJobCard
              key={job.id}
              job={job}
              onEnlarge={handleEnlargeTagging}
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

  return (
    <>
      <TrainingDetailModal
        jobId={detail?.type === 'training' ? detail.id : null}
        onClose={handleCloseDetail}
      />
      <TaggingDetailModal
        jobId={detail?.type === 'tagging' ? detail.id : null}
        onClose={handleCloseDetail}
        onCancel={handleCancelTagging}
      />
      {panelContent}
    </>
  );
};

export const ActivityPanel = memo(ActivityPanelComponent);
