'use client';

import { useAppDispatch } from '@/app/store/hooks';
import { openJobDetail } from '@/app/store/jobs';
import type { LoadedProject } from '@/app/store/training-config/types';

import { useTrainingHistoryModal } from '../training-history-modal/use-training-history-modal';
import { MENU_HEADING_CLASS, MENU_ITEM_CLASS } from './menu-styles';
import { type RecentRun, useRecentRuns } from './use-recent-runs';

/** How many of the project's runs the menu lists before deferring to history. */
const MAX_RUNS_SHOWN = 3;

/** Dot colour per run status — the same reading the history modal gives them. */
const STATUS_DOT: Record<string, string> = {
  pending: 'bg-slate-400',
  preparing: 'bg-sky-500',
  running: 'bg-sky-500',
  completed: 'bg-green-500',
  failed: 'bg-rose-500',
  cancelled: 'bg-slate-400',
  interrupted: 'bg-amber-500',
};

/** Compact "just now" / "12m ago" / "3d ago" for a run's finish time. */
function formatAgo(at: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

type RecentRunsProps = {
  project: LoadedProject;
  /** Dismiss the menu — every row opens something in front of it. */
  onClose: () => void;
};

/**
 * The current project's latest training runs, listed in the project menu
 * between the actions that act on this project and the ones that leave it.
 *
 * Renders nothing when the project has never been trained, so a menu for a
 * fresh project is no longer than it was before.
 */
export const RecentRuns = ({ project, onClose }: RecentRunsProps) => {
  const dispatch = useAppDispatch();
  const { openModal: openHistory } = useTrainingHistoryModal();

  const runs = useRecentRuns(project);
  if (runs.length === 0) return null;

  const shown = runs.slice(0, MAX_RUNS_SHOWN);

  const handleOpenRun = (run: RecentRun) => {
    onClose();
    // A run the panel still holds opens in the activity panel's detail modal,
    // which keeps updating while it's in flight. One that only survives as an
    // archived snapshot has no live job to point that modal at, so it opens in
    // the history modal instead — same body, static data.
    if (run.source === 'job') {
      dispatch(openJobDetail({ id: run.id, type: 'training' }));
    } else {
      openHistory(run.id);
    }
  };

  const handleOpenHistory = () => {
    onClose();
    openHistory();
  };

  return (
    <div className="flex flex-col py-1">
      <p className={MENU_HEADING_CLASS}>Recent Runs</p>

      {shown.map((run) => (
        <button
          key={run.id}
          type="button"
          onClick={() => handleOpenRun(run)}
          className={MENU_ITEM_CLASS}
          title={`Open ${run.name}`}
        >
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              STATUS_DOT[run.status] ?? 'bg-slate-400'
            }`}
          />
          <span className="truncate">{run.name}</span>
          <span className="ml-auto shrink-0 text-slate-400 tabular-nums">
            {run.version != null && `v${run.version} · `}
            {run.isActive ? 'Running' : formatAgo(run.at)}
          </span>
        </button>
      ))}

      {runs.length > shown.length && (
        <button
          type="button"
          onClick={handleOpenHistory}
          className={`${MENU_ITEM_CLASS} text-slate-500 dark:text-slate-400`}
        >
          <span className="h-2 w-2 shrink-0" />
          All {runs.length} runs…
        </button>
      )}
    </div>
  );
};
