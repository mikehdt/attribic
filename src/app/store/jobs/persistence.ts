/**
 * Persistence for jobs across browser sessions.
 *
 * Uses localStorage so jobs survive closing the browser overnight.
 *
 * - **Downloads**: all download jobs (including completed) are persisted so
 *   the activity panel shows history until the user explicitly clears it.
 * - **Training**: only *terminal* training jobs (completed/failed/cancelled)
 *   are persisted. In-flight jobs are owned by the Python sidecar and
 *   restored via `hydrateActiveTraining`. The sidecar currently only
 *   remembers the latest run in its `active_job` slot, so we persist the
 *   older terminal ones client-side to keep the history visible across
 *   refreshes. (Future option: move this history into the sidecar and
 *   expose a `/jobs/recent` endpoint — would make it multi-client-friendly.)
 */

import type { DownloadJob, Job, TrainingJob } from './types';

const DOWNLOAD_KEY = 'img-tagger:download-jobs';
const TRAINING_KEY = 'img-tagger:training-jobs';

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

/**
 * Save current download jobs to localStorage.
 * Called by middleware whenever the jobs state changes.
 */
export function persistDownloadJobs(jobs: Record<string, Job>): void {
  try {
    // `pending` downloads are queued but never started — nothing is on disk
    // and the in-memory concurrency queue doesn't survive a reload, so
    // persisting them would leave orphaned "queued" entries that never run.
    const downloadJobs = Object.values(jobs).filter(
      (j): j is DownloadJob => j.type === 'download' && j.status !== 'pending',
    );

    if (downloadJobs.length === 0) {
      localStorage.removeItem(DOWNLOAD_KEY);
    } else {
      localStorage.setItem(DOWNLOAD_KEY, JSON.stringify(downloadJobs));
    }
  } catch {
    // localStorage may be unavailable (SSR, private browsing)
  }
}

/**
 * Load persisted download jobs from localStorage.
 * Jobs are returned as-is; reconciliation against the server's
 * active-download set happens asynchronously via
 * {@link reconcileDownloadsWithServer} so another tab's still-running
 * download isn't incorrectly shown as interrupted.
 */
export function loadPersistedDownloads(): DownloadJob[] {
  try {
    const raw = localStorage.getItem(DOWNLOAD_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as DownloadJob[];
  } catch {
    return [];
  }
}

/**
 * Ask the server which downloads are genuinely in flight and return the
 * ids of persisted jobs whose `running`/`preparing` status is stale (i.e.
 * nothing's actively downloading them server-side). Callers mark those
 * as interrupted; jobs the server still reports as `downloading` are
 * left alone so the owning tab's stream continues to drive them.
 */
export async function reconcileDownloadsWithServer(
  jobs: DownloadJob[],
): Promise<string[]> {
  const candidates = jobs.filter(
    (j) => j.status === 'running' || j.status === 'preparing',
  );
  if (candidates.length === 0) return [];

  try {
    const res = await fetch('/api/model-manager/status');
    if (!res.ok) return [];
    const data = (await res.json()) as {
      statuses: Record<string, { status: string }>;
    };
    return candidates
      .filter((j) => data.statuses[j.modelId]?.status !== 'downloading')
      .map((j) => j.id);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

/**
 * Save terminal training jobs (completed/failed/cancelled) to localStorage.
 * In-flight jobs are skipped — the sidecar owns those and they'd fight
 * with the hydrate-on-mount logic.
 */
export function persistTrainingJobs(jobs: Record<string, Job>): void {
  try {
    const terminal = Object.values(jobs).filter(
      (j): j is TrainingJob =>
        j.type === 'training' && TERMINAL_STATUSES.has(j.status),
    );

    if (terminal.length === 0) {
      localStorage.removeItem(TRAINING_KEY);
    } else {
      localStorage.setItem(TRAINING_KEY, JSON.stringify(terminal));
    }
  } catch {
    // localStorage may be unavailable (SSR, private browsing)
  }
}

/**
 * Load persisted terminal training jobs from localStorage.
 * Only terminal ones are saved, so no status remapping is needed.
 */
export function loadPersistedTrainingJobs(): TrainingJob[] {
  try {
    const raw = localStorage.getItem(TRAINING_KEY);
    if (!raw) return [];
    const jobs: TrainingJob[] = JSON.parse(raw);
    // Defensive filter in case an older build stashed non-terminal entries.
    return jobs.filter((j) => TERMINAL_STATUSES.has(j.status));
  } catch {
    return [];
  }
}
