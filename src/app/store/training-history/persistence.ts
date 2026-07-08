/**
 * Durable persistence for the training run history.
 *
 * This is the single persisted home for terminal training runs — the jobs
 * slice no longer keeps its own `img-tagger:training-jobs` copy. It is a
 * long-lived archive: "Clear all" on the activity panel only flips each run's
 * `dismissedFromPanel` flag (so it leaves the panel) rather than wiping the
 * store, so the Training menu's "Run History" view keeps showing every
 * completed/failed/cancelled run indefinitely.
 */

import type { TrainingHistoryEntry } from './index';

const HISTORY_KEY = 'img-tagger:training-history';

/** Save the whole history archive to localStorage. */
export function persistTrainingHistory(
  entries: Record<string, TrainingHistoryEntry>,
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
export function loadPersistedTrainingHistory(): TrainingHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const list: TrainingHistoryEntry[] = JSON.parse(raw);
    return list.filter((j) => j.type === 'training');
  } catch {
    return [];
  }
}
