import {
  ChevronRightIcon,
  DownloadIcon,
  ScanSearchIcon,
  XIcon,
} from 'lucide-react';
import { useState } from 'react';

import { useAppDispatch } from '@/app/store/hooks';
import { type Job, removeJob } from '@/app/store/jobs';
import {
  cancelDownload,
  clearDownload,
} from '@/app/store/jobs/download-runtime';

export function PendingJobsList({ jobs }: { jobs: Job[] }) {
  const dispatch = useAppDispatch();
  const [expanded, setExpanded] = useState(false);

  /**
   * A queued download is queued in the *sidecar*, so dropping the card alone
   * would leave it to start downloading anyway — and the next resync would
   * bring the card straight back. Cancel it there first, then retire the
   * record.
   */
  const handleRemove = (job: Job) => {
    if (job.type === 'download') {
      void dispatch(cancelDownload(job.id)).then(() =>
        dispatch(clearDownload(job.id)),
      );
      return;
    }
    dispatch(removeJob(job.id));
  };

  const label = `${jobs.length} queued ${jobs.length === 1 ? 'job' : 'jobs'}`;

  return (
    <div className="border-b border-(--border-subtle) last:border-b-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-1.5 px-3 py-2 text-left"
      >
        <ChevronRightIcon
          className={`h-3 w-3 text-slate-400 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
        />
        <span className="text-xs text-slate-500">{label}</span>
      </button>

      {expanded && (
        <div className="pb-1">
          {jobs.map((job) => {
            const name =
              job.type === 'download'
                ? job.modelName
                : job.type === 'tagging'
                  ? job.modelName
                  : job.config?.outputName || 'Training';
            const icon =
              job.type === 'download' ? (
                <DownloadIcon className="h-3 w-3 text-slate-400" />
              ) : job.type === 'tagging' ? (
                <ScanSearchIcon className="h-3 w-3 text-slate-400" />
              ) : (
                <span className="h-2 w-2 rounded-full bg-slate-300" />
              );

            return (
              <div
                key={job.id}
                className="flex items-center justify-between px-3 py-1"
              >
                <div className="flex items-center gap-2">
                  {icon}
                  <span className="text-[11px] text-slate-500">{name}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(job)}
                  className="cursor-pointer rounded p-0.5 text-slate-300 hover:text-slate-500 dark:text-slate-600 dark:hover:text-slate-400"
                  title="Remove from queue"
                >
                  <XIcon className="h-2.5 w-2.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
