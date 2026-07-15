'use client';

import { ArrowLeftIcon, HistoryIcon, Trash2Icon } from 'lucide-react';
import { useCallback, useState } from 'react';

import { formatDuration } from '@/app/shared/activity-panel/helpers';
import { TrainingDetailContent } from '@/app/shared/activity-panel/training-detail-modal/training-detail-content';
import { Button } from '@/app/shared/button';
import { Modal } from '@/app/shared/modal';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
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
}: {
  entry: TrainingHistoryEntry;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const status = STATUS_META[entry.status] ?? STATUS_META.cancelled;
  const elapsed =
    entry.completedAt != null && entry.startedAt != null
      ? entry.completedAt - entry.startedAt
      : null;
  const params = paramSummary(entry);

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
 * Run-history modal. Lists archived training runs (durable — not affected by
 * the activity panel's "Clear all"); clicking a run swaps the modal to its
 * detail view in place, reusing the same body the activity panel shows for a
 * live job. Opened from the Training menu via {@link useTrainingHistoryModal}.
 */
export function TrainingHistoryModal() {
  const dispatch = useAppDispatch();
  const { isOpen, closeModal } = useTrainingHistoryModal();
  const history = useAppSelector(selectTrainingHistory);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId
    ? (history.find((e) => e.id === selectedId) ?? null)
    : null;

  const handleClose = useCallback(() => {
    setSelectedId(null);
    closeModal();
  }, [closeModal]);

  const handleDelete = useCallback(
    (id: string) => {
      dispatch(deleteHistoryEntry(id));
      setSelectedId((cur) => (cur === id ? null : cur));
    },
    [dispatch],
  );

  const handleClearAll = useCallback(() => {
    dispatch(clearHistory());
    setSelectedId(null);
  }, [dispatch]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      className="w-full max-w-3xl"
      labelledById={selected ? undefined : 'training-history-modal-title'}
      ariaLabel={selected ? 'Training history' : undefined}
    >
      {selected ? (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="flex w-fit cursor-pointer items-center gap-1.5 text-sm text-slate-500 hover:text-(--foreground)"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Back to history
          </button>
          <TrainingDetailContent job={selected} />
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

          {history.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">
              No training runs yet. Completed, failed, and cancelled runs will
              appear here.
            </p>
          ) : (
            <>
              <div className="-mx-2 max-h-[60vh] overflow-y-auto rounded-md border border-(--border-subtle)">
                {history.map((entry) => (
                  <HistoryRow
                    key={entry.id}
                    entry={entry}
                    onOpen={setSelectedId}
                    onDelete={handleDelete}
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
