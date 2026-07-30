'use client';

import {
  ArrowLeftIcon,
  HistoryIcon,
  PlayIcon,
  ServerOffIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
} from 'lucide-react';
import { useCallback, useEffect } from 'react';

import { formatDuration } from '@/app/shared/activity-panel/helpers';
import { showsSamplesView } from '@/app/shared/activity-panel/training-detail-modal/training-detail-tabs/samples-model';
import { TrainingDetailTabs } from '@/app/shared/activity-panel/training-detail-modal/training-detail-tabs/training-detail-tabs';
import { Button } from '@/app/shared/button';
import { Modal } from '@/app/shared/modal';
import { useConfirmAction } from '@/app/shared/use-confirm-action';
import {
  type SidecarStatus,
  useSidecarStatus,
} from '@/app/shared/use-sidecar-status';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import { removeJob } from '@/app/store/jobs';
import { addToast } from '@/app/store/toasts/reducers';
import { hydrateTrainingHistory } from '@/app/store/training/training-runtime';
import { hydrateFromRun } from '@/app/store/training-config';
import {
  clearHistory,
  deleteHistoryEntry,
  selectTrainingHistory,
  type TrainingHistoryEntry,
} from '@/app/store/training-history';

import { useTrainingHistoryModal } from './use-training-history-modal';

const STATUS_META: Record<
  string,
  { dot: string; label: string; text: string }
> = {
  completed: {
    dot: 'bg-green-500',
    label: 'Completed',
    text: 'text-green-600 dark:text-green-400',
  },
  failed: {
    dot: 'bg-rose-500',
    label: 'Failed',
    text: 'text-rose-600 dark:text-rose-400',
  },
  cancelled: {
    dot: 'bg-slate-400',
    label: 'Cancelled',
    text: 'text-slate-500',
  },
};

function formatWhen(ts: number | null): string {
  if (ts == null) return '';
  return new Date(ts).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** One line of headline hyperparameters for a run, e.g. "10 epochs · LR 1e-4 · rank 16". */
function paramSummary(entry: TrainingHistoryEntry): string {
  const hp = entry.config?.hyperparameters;
  if (!hp) return '';
  const parts: string[] = [];
  if (hp.epochs) parts.push(`${hp.epochs} epochs`);
  if (hp.learningRate != null) parts.push(`LR ${hp.learningRate}`);
  if (hp.networkDim != null) parts.push(`rank ${hp.networkDim}`);
  return parts.join(' · ');
}

function HistoryRow({
  entry,
  onOpen,
  onDelete,
  onReuse,
}: {
  entry: TrainingHistoryEntry;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onReuse: (entry: TrainingHistoryEntry) => void;
}) {
  const status = STATUS_META[entry.status] ?? STATUS_META.cancelled;
  const elapsed =
    entry.completedAt != null && entry.startedAt != null
      ? entry.completedAt - entry.startedAt
      : null;
  const params = paramSummary(entry);

  // Reusing replaces the whole form, discarding whatever is being edited —
  // worth a second click, since the row's main body is a click target too.
  const handleConfirmReuse = useCallback(
    () => onReuse(entry),
    [onReuse, entry],
  );
  const { armed: confirmingReuse, trigger: handleReuseClick } =
    useConfirmAction(handleConfirmReuse);

  // Runs archived before we started snapshotting the form can't be reused —
  // their stored config is a display summary, not a rebuildable setup.
  const canReuse = entry.formSnapshot != null;

  return (
    <div className="group flex items-center gap-3 border-b border-(--border-subtle) px-3 py-2.5 last:border-b-0 hover:bg-slate-100 dark:hover:bg-slate-700/50">
      <button
        type="button"
        onClick={() => onOpen(entry.id)}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${status.dot}`} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-sm font-medium text-(--foreground)">
              {entry.config?.outputName || 'Training run'}
            </span>
            <span className={`shrink-0 text-xs ${status.text}`}>
              {status.label}
            </span>
          </span>
          <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-400">
            <span>{formatWhen(entry.completedAt ?? entry.createdAt)}</span>
            {elapsed != null && <span>· {formatDuration(elapsed)}</span>}
            {params && <span>· {params}</span>}
          </span>
        </span>
      </button>

      {canReuse && (
        <Button
          onClick={handleReuseClick}
          size="sm"
          variant="ghost"
          color={confirmingReuse ? 'amber' : 'slate'}
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          title={
            confirmingReuse
              ? 'Click again to replace the current form with this run’s settings'
              : 'Load this run’s settings into the training form'
          }
        >
          <SlidersHorizontalIcon />
          {confirmingReuse ? 'Replace form?' : 'Use these settings'}
        </Button>
      )}

      <button
        type="button"
        onClick={() => onDelete(entry.id)}
        title="Remove from history"
        className="shrink-0 cursor-pointer rounded p-1 text-slate-400 opacity-0 transition-opacity group-hover:opacity-100 hover:text-rose-500"
      >
        <Trash2Icon className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * Sidecar readout for the list view. Run history is the sidecar's `jobs/*.json`
 * records read back — so with no sidecar, the list is only whatever this
 * session happened to watch finish, and a cold start shows nothing at all.
 * Without this note that state is indistinguishable from "you have never
 * trained anything", which is what it used to look like.
 */
function SidecarNote({
  status,
  busy,
  onStart,
}: {
  status: SidecarStatus;
  busy: boolean;
  onStart: () => void;
}) {
  // Nothing to say while it's up, and nothing worth saying before the first
  // status read comes back — a note that flashes on every open is just noise.
  if (status === 'ready' || status === 'unknown') return null;

  const starting = status === 'starting';

  return (
    <div className="mb-3 flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
      <ServerOffIcon className="h-4 w-4 shrink-0 text-amber-500" />
      <p className="flex-1 text-sm text-(--foreground)/70">
        {starting
          ? 'Starting the training sidecar — past runs will appear once it’s up.'
          : status === 'error'
            ? 'The training sidecar couldn’t be started, so past runs can’t be read from disk.'
            : 'The training sidecar isn’t running. Past runs are stored by it, so this list may be incomplete.'}
      </p>
      {!starting && (
        <Button size="sm" color="amber" onClick={onStart} disabled={busy}>
          <PlayIcon />
          {status === 'error' ? 'Try again' : 'Start sidecar'}
        </Button>
      )}
    </div>
  );
}

/**
 * Run-history modal. Lists archived training runs (durable — not affected by
 * the activity panel's "Clear all"); clicking a run swaps the modal to its
 * detail view in place, reusing the same body the activity panel shows for a
 * live job. Opened from the Training menu via {@link useTrainingHistoryModal}.
 */
export function TrainingHistoryModal() {
  const dispatch = useAppDispatch();
  const { isOpen, entryId, selectEntry, closeModal } =
    useTrainingHistoryModal();
  const history = useAppSelector(selectTrainingHistory);

  // Which run is showing lives in the modal's shared open state, so opening
  // straight onto one (the project menu's recent runs) and drilling in from
  // the list here are the same operation.
  const selected = entryId
    ? (history.find((e) => e.id === entryId) ?? null)
    : null;
  const selectedWide = selected != null && showsSamplesView(selected);

  // Sidecar status, polled only while this view is open. The list can't be
  // trusted without one, so the user gets told — and gets a way to start it.
  const {
    status: sidecarStatus,
    action: sidecarAction,
    start: startSidecar,
  } = useSidecarStatus(isOpen);

  // Re-read the sidecar's records whenever there's a sidecar to read them from:
  // each time the view opens, and again if one comes up while it's open (the
  // note's Start button, or the app-launch warm-up landing late). Gating on
  // `ready` keeps this from burning the thunk's retry ladder against a sidecar
  // we already know is down. Idempotent — it only fills gaps.
  useEffect(() => {
    if (!isOpen || sidecarStatus !== 'ready') return;
    void dispatch(hydrateTrainingHistory());
  }, [isOpen, sidecarStatus, dispatch]);

  const handleClose = useCallback(() => {
    closeModal();
  }, [closeModal]);

  // Deleting a run has to take its activity-panel card with it, and in this
  // order. The history middleware re-archives any terminal job in the jobs slice
  // that history doesn't know about, on every `jobs/` action — so removing the
  // history entry first would leave the card behind, and the very next `jobs/`
  // action would record it straight back (with sample paths the delete has
  // already swept). `removeJob` is itself a `jobs/` action, but it runs while
  // history still holds the entry, so that sweep is a no-op.
  const handleDelete = useCallback(
    (id: string) => {
      dispatch(removeJob(id));
      dispatch(deleteHistoryEntry(id));
      if (entryId === id) selectEntry(null);
    },
    [dispatch, entryId, selectEntry],
  );

  const handleClearAll = useCallback(() => {
    // Same ordering constraint as handleDelete, for every run being wiped.
    for (const entry of history) dispatch(removeJob(entry.id));
    dispatch(clearHistory());
    selectEntry(null);
  }, [dispatch, history, selectEntry]);

  // Load a past run's settings into the form and get out of the way — the form
  // is directly behind this modal, so there's nowhere to navigate to.
  const handleReuse = useCallback(
    (entry: TrainingHistoryEntry) => {
      if (!entry.formSnapshot) return;
      // An archived run's datasets are as old as the run; hydrating drops what
      // it claimed about them, and `useDatasetScanSync` re-reads the folders so
      // one that's since moved is flagged rather than silently trained against.
      dispatch(hydrateFromRun(entry.formSnapshot));
      dispatch(
        addToast({
          children: `Loaded settings from “${entry.config?.outputName || 'training run'}”`,
        }),
      );
      handleClose();
    },
    [dispatch, handleClose],
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      className={`w-full ${selectedWide ? 'max-w-5xl' : 'max-w-3xl'}`}
      labelledById={selected ? undefined : 'training-history-modal-title'}
      ariaLabel={selected ? 'Training history' : undefined}
    >
      {selected ? (
        <div className="flex flex-col gap-3">
          <span>
            <Button variant="ghost" size="sm" onClick={() => selectEntry(null)}>
              <ArrowLeftIcon />
              Back to history
            </Button>
          </span>
          <TrainingDetailTabs key={selected.id} job={selected} />
        </div>
      ) : (
        <div className="flex flex-col">
          <div className="mb-2 flex items-center gap-2">
            <HistoryIcon className="h-6 w-6 text-(--unselected-text)" />
            <h2
              id="training-history-modal-title"
              className="text-2xl font-semibold text-slate-700 dark:text-slate-200"
            >
              Run history
            </h2>
          </div>

          <SidecarNote
            status={sidecarStatus}
            busy={sidecarAction !== null}
            onStart={startSidecar}
          />

          {history.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">
              {sidecarStatus === 'ready' || sidecarStatus === 'unknown'
                ? 'No training runs yet. Completed, failed, and cancelled runs will appear here.'
                : 'No runs to show. Past runs are read back from the training sidecar.'}
            </p>
          ) : (
            <>
              <div className="-mx-2 max-h-[60vh] overflow-y-auto rounded-md border border-(--border-subtle)">
                {history.map((entry) => (
                  <HistoryRow
                    key={entry.id}
                    entry={entry}
                    onOpen={selectEntry}
                    onDelete={handleDelete}
                    onReuse={handleReuse}
                  />
                ))}
              </div>
              <div className="mt-3 flex justify-end">
                <Button onClick={handleClearAll} size="sm" variant="ghost">
                  <Trash2Icon className="mr-1 h-3.5 w-3.5" />
                  Clear history
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
