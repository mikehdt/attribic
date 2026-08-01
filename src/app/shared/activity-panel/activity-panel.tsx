'use client';

import { ActivityIcon, ChevronDownIcon, XIcon } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { memo, useCallback, useEffect, useRef } from 'react';

import { cancelTaggingJob } from '@/app/services/auto-tagger/tagging-controllers';
import { useIsAnyModalOpen } from '@/app/shared/modal';
import { useStatsPolling } from '@/app/shared/stats/use-stats';
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
  selectIsTraining,
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
  dismissTrainingJobs,
  hydrateTrainingHistory,
} from '@/app/store/training/training-runtime';
import { dismissAllFromPanel } from '@/app/store/training-history';

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

  // Keep host load sampling for as long as a run is training, from here —
  // the panel is mounted in the root layout, so it outlives every surface that
  // actually draws the figures. The rolling history behind the detail modal's
  // sparklines is meant to be the run's timeline, and it can only be that if
  // sampling doesn't stop each time the modal is closed or the panel minimised.
  // Nothing polls while the machine is idle, which was the point of gating it.
  useStatsPolling(useAppSelector(selectIsTraining));

  // Push up above the bottom shelf on views that have one
  const hasBottomShelf =
    pathname.startsWith('/tagging') || pathname.startsWith('/training');
  const bottomClass = hasBottomShelf ? 'bottom-16' : 'bottom-4';

  // Restore past training runs and persisted downloads on mount. Training runs
  // are read back from their records under `.training/jobs` (the source of truth
  // for them); downloads still persist to localStorage, being a purely
  // client-side concern.
  // Downloads that were `running` when the page closed are restored as-is,
  // then reconciled against the server's active-download set: another tab
  // may still own the stream, in which case we leave the job alone. Only
  // jobs the server no longer tracks get flipped to `interrupted`.
  const restoredRef = useRef(false);
  const historyRef = useRef(false);
  useEffect(() => {
    // Past training runs are read from their durable records on disk — that
    // seeds both the run-history archive and the panel's terminal-training rows
    // (skipping runs the user has cleared). Async and self-contained, so it
    // doesn't gate the download restore below. One read is enough: the route
    // owns the records rather than proxying a sidecar that may not be up, so
    // there's no "asked too early" case to retry.
    if (!historyRef.current) {
      historyRef.current = true;
      void dispatch(hydrateTrainingHistory());
    }

    if (restoredRef.current) return;
    restoredRef.current = true;

    const downloads = loadPersistedDownloads();
    if (downloads.length === 0) return;

    dispatch(restoreJobs(downloads));
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
    // Terminal training runs live on their own durable records, not in the jobs
    // slice's persistence. Mark them dismissed locally for an immediate response…
    dispatch(dismissAllFromPanel());
    // …and on the records, which is what makes it stick across a refresh.
    // Dismissing is not deleting: the runs stay in the Run History view, and only
    // an explicit delete there removes them. Delivery-checked, and a dismissal
    // that didn't land is re-read rather than assumed — the cards come back,
    // which is what the records actually say.
    void dismissTrainingJobs().then((recorded) => {
      if (!recorded) void dispatch(hydrateTrainingHistory());
    });
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
        <span className="flex items-center text-sm text-(--foreground)">
          <ActivityIcon className="mr-2 h-3.5 w-3.5 text-slate-500" />
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
        <div className="flex justify-end border-t border-t-slate-300 px-3 py-1.5 dark:border-t-slate-700">
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
