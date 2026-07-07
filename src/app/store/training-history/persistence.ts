/**
 * Durable persistence for the training run history.
 *
 * Unlike the activity panel's terminal-training-job persistence
 * (`jobs/persistence.ts` → `img-tagger:training-jobs`), this store is a
 * long-lived archive: it is *not* wiped when the user clicks "Clear all" on
 * the activity panel. Every completed/failed/cancelled run is snapshotted
 * here so the Training menu's "Run History" view can show it indefinitely.
 */

import type { TrainingJob } from '../jobs/types';

const HISTORY_KEY = 'img-tagger:training-history';

/** Save the whole history archive to localStorage. */
export function persistTrainingHistory(
  entries: Record<string, TrainingJob>,
): void {
  try {
    const list = Object.values(entries);
    if (list.length === 0) {
      localStorage.removeItem(HISTORY_KEY);
    } else {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    }
  } catch {
    // localStorage may be unavailable (SSR, private browsing)
  }
}

/** Load the persisted history archive from localStorage. */
export function loadPersistedTrainingHistory(): TrainingJob[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const list: TrainingJob[] = JSON.parse(raw);
    return list.filter((j) => j.type === 'training');
  } catch {
    return [];
  }
}
