/**
 * Download runtime thunks: start, cancel, retry, delete, hydrate.
 *
 * Downloads are owned by the Python sidecar, which outlives both the browser
 * tab and the Node process — so a refresh or an HMR restart no longer kills a
 * transfer mid-file. This module is the client's view of that: it POSTs through
 * `/api/model-manager/*` and streams live progress from a direct WebSocket on
 * the sidecar's `ws/downloads` channel.
 *
 * The shape deliberately mirrors `store/training/training-runtime.ts`, which
 * solved the same problem for training runs: nothing about a download is
 * persisted client-side, because the sidecar's records under
 * `<training>/downloads/` are the single source of truth and a local copy could
 * only ever disagree with them.
 */

import { fetchJson } from '@/app/utils/fetch-json';

import type { AppThunk } from '../index';
import { fetchModelStatuses, setModelStatus } from '../model-manager';
import { addToast } from '../toasts/reducers';
import { forgetDeletedModelFiles } from '../training-config/thunks';
import {
  addJob,
  openPanel,
  removeJob,
  updateDownloadProgress,
  updateJobStatus,
} from './index';
import type { DownloadJob, JobStatus } from './types';

// WebSocket handlers need a dispatch that accepts thunks as well as actions;
// see the identical note in training-runtime.ts.
type ThunkDispatch = (action: unknown) => unknown;

// ---------------------------------------------------------------------------
// Sidecar payload (snake_case — matches training-sidecar/downloads/manager.py)
// ---------------------------------------------------------------------------

type SidecarDownloadStatus =
  'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

type SidecarDownload = {
  job_id: string;
  model_id: string;
  model_name: string;
  status: SidecarDownloadStatus;
  bytes_downloaded: number;
  total_bytes: number;
  current_file: string | null;
  file_index: number | null;
  total_files: number | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

/**
 * A queued download is `pending` here — the same status a training job waiting
 * on the sidecar's queue carries, so the activity panel's pending list picks it
 * up without knowing anything about downloads.
 */
const STATUS_MAP: Record<SidecarDownloadStatus, JobStatus> = {
  queued: 'pending',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
};

const isTerminal = (status: SidecarDownloadStatus): boolean =>
  status === 'completed' || status === 'failed' || status === 'cancelled';

/** Model-manager status to mirror for a download in this state. */
function modelStatusFor(status: SidecarDownloadStatus) {
  if (status === 'completed') return 'ready' as const;
  if (status === 'failed') return 'error' as const;
  if (status === 'cancelled') return 'not_installed' as const;
  return 'downloading' as const;
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 5000, 10_000];

const ws: {
  socket: WebSocket | null;
  port: number | null;
  reconnectTimer: number | null;
  reconnectAttempts: number;
  dispatch: ThunkDispatch | null;
} = {
  socket: null,
  port: null,
  reconnectTimer: null,
  reconnectAttempts: 0,
  dispatch: null,
};

/** Apply one sidecar record to the store, seeding the job if it's new. */
function applyDownload(dispatch: ThunkDispatch, entry: SidecarDownload): void {
  const status = STATUS_MAP[entry.status];

  // Before the store learns the new status — the completion check needs to
  // see what the job was, not what it's about to become.
  dispatch(reconcileCompletedDownload(entry));

  dispatch(
    addJobIfMissing({
      id: entry.job_id,
      type: 'download',
      status,
      createdAt: Date.parse(entry.created_at) || Date.now(),
      startedAt: entry.started_at ? Date.parse(entry.started_at) : null,
      completedAt: entry.completed_at ? Date.parse(entry.completed_at) : null,
      error: entry.error,
      modelId: entry.model_id,
      modelName: entry.model_name,
      targetDir: '',
      progress: null,
    }),
  );

  // Progress first, then status: `updateDownloadProgress` forces the job to
  // `running`, so applying it after a terminal transition would un-finish a
  // download that had just completed.
  if (entry.total_bytes > 0 || entry.bytes_downloaded > 0) {
    dispatch(
      updateDownloadProgress({
        id: entry.job_id,
        progress: {
          bytesDownloaded: entry.bytes_downloaded,
          totalBytes: entry.total_bytes,
          currentFile: entry.current_file ?? undefined,
          fileIndex: entry.file_index ?? undefined,
          totalFiles: entry.total_files ?? undefined,
        },
      }),
    );
  }

  dispatch(
    updateJobStatus({
      id: entry.job_id,
      status,
      error: entry.error,
      completedAt: entry.completed_at ? Date.parse(entry.completed_at) : null,
    }),
  );

  dispatch(
    setModelStatus({
      modelId: entry.model_id,
      status: modelStatusFor(entry.status),
    }),
  );
}

/**
 * Refetch model statuses when a download we were watching finishes.
 *
 * The sidecar's payload says a model is ready but not *where* — and
 * `setModelStatus` without a path leaves `resolveInstalledPath` returning
 * null, so the training form's component field stays empty as if nothing
 * had downloaded. Only the status route can fill the gap: it reads the
 * download manifest and computes the variant-aware resolved path (fp8 vs
 * fp16 filename, single file vs bundle directory), which the client can't
 * derive on its own.
 *
 * Gated on an observed transition out of a live status, not on the record
 * being completed: resyncs replay every terminal record they find, and a
 * page load already fetches statuses on its own.
 */
function reconcileCompletedDownload(entry: SidecarDownload): AppThunk {
  return (dispatch, getState) => {
    if (entry.status !== 'completed') return;
    const previous = getState().jobs.jobs[entry.job_id]?.status;
    if (
      previous !== 'pending' &&
      previous !== 'running' &&
      previous !== 'interrupted'
    ) {
      return;
    }
    void dispatch(fetchModelStatuses());
  };
}

/**
 * `addJob` overwrites, which would wipe a running job's accumulated progress
 * every time a resync ran. Seed only what we don't already have.
 */
function addJobIfMissing(job: DownloadJob): AppThunk {
  return (dispatch, getState) => {
    if (getState().jobs.jobs[job.id]) return;
    dispatch(addJob(job));
  };
}

/**
 * Pull the sidecar's whole download list and fold it in.
 *
 * The socket is a delta stream — it only carries what changed while someone
 * was listening — so a drop strands whatever moved during the gap. This is
 * what makes a reconnect (and a page refresh) actually recover.
 */
async function resyncDownloads(dispatch: ThunkDispatch): Promise<void> {
  let data: { sidecarAvailable: boolean; downloads: SidecarDownload[] };
  try {
    data = await fetchJson('/api/model-manager/downloads');
  } catch {
    // Best-effort — stale state stays, and the next live tick corrects it.
    return;
  }

  if (!data.sidecarAvailable) {
    dispatch(markInFlightInterrupted());
    return;
  }

  for (const entry of data.downloads) {
    applyDownload(dispatch, entry);
    noteLiveness(entry);
  }
}

/**
 * The sidecar has gone (shut down from the global menu, or killed), so nothing
 * is moving any more. Say so rather than leaving cards frozen on a progress
 * bar that will never advance — the partials are still on disk, so Retry
 * resumes them the moment the sidecar is back.
 */
function markInFlightInterrupted(): AppThunk {
  return (dispatch, getState) => {
    for (const job of Object.values(getState().jobs.jobs)) {
      if (job.type !== 'download') continue;
      if (job.status !== 'running' && job.status !== 'pending') continue;
      dispatch(
        updateJobStatus({
          id: job.id,
          status: 'interrupted',
          error: 'Sidecar stopped — click Retry to resume',
        }),
      );
      liveJobs.delete(job.id);
    }
  };
}

/**
 * Job ids the sidecar still has work for. Tracked as a set rather than a
 * counter so a terminal event delivered twice (a live tick plus the resync
 * that follows a reconnect) can't drive the tally negative and keep a dead
 * socket retrying forever.
 */
const liveJobs = new Set<string>();

function noteLiveness(entry: SidecarDownload): void {
  if (isTerminal(entry.status)) liveJobs.delete(entry.job_id);
  else liveJobs.add(entry.job_id);
}

function scheduleReconnect(): void {
  if (ws.reconnectTimer !== null || ws.socket) return;
  const { dispatch, port } = ws;
  if (!dispatch || port === null) return;

  if (liveJobs.size === 0) {
    ws.reconnectAttempts = 0;
    return;
  }

  const delay =
    RECONNECT_DELAYS_MS[
      Math.min(ws.reconnectAttempts, RECONNECT_DELAYS_MS.length - 1)
    ]!;
  ws.reconnectAttempts += 1;

  ws.reconnectTimer = window.setTimeout(() => {
    ws.reconnectTimer = null;
    openDownloadSocket(dispatch, port);
  }, delay);
}

function openDownloadSocket(dispatch: ThunkDispatch, port: number): void {
  ws.port = port;
  ws.dispatch = dispatch;

  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/downloads`);
  ws.socket = socket;

  socket.addEventListener('open', () => {
    if (ws.socket !== socket) return;
    ws.reconnectAttempts = 0;
    void resyncDownloads(dispatch);
  });

  socket.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data as string) as SidecarDownload;
      if (!msg.job_id) return;
      applyDownload(dispatch, msg);
      noteLiveness(msg);
    } catch (err) {
      console.warn('[download-ws] Failed to parse message:', err);
    }
  });

  socket.addEventListener('close', () => {
    // A socket we already replaced (or tore down deliberately, which nulls
    // `ws.socket` first) — its close is not a drop.
    if (ws.socket !== socket) return;
    ws.socket = null;
    // Resync before deciding to retry: a close because the sidecar went away
    // marks the cards interrupted and empties `liveJobs`, which is what stops
    // us reconnecting to a port with nothing behind it forever.
    void resyncDownloads(dispatch).then(scheduleReconnect);
  });

  socket.addEventListener('error', () => {
    console.warn('[download-ws] Socket error — will retry if one is live');
  });
}

/** Open the progress socket if it isn't already up. */
function ensureDownloadSocket(dispatch: ThunkDispatch, port: number): void {
  if (ws.socket && ws.socket.readyState <= WebSocket.OPEN) return;
  openDownloadSocket(dispatch, port);
}

/** The sidecar's port, or the default when it can't be read. */
async function sidecarPort(): Promise<number> {
  try {
    const data = await fetchJson<{ port?: number }>('/api/training/sidecar');
    return data.port ?? 9733;
  } catch {
    return 9733;
  }
}

// ---------------------------------------------------------------------------
// Thunks
// ---------------------------------------------------------------------------

/**
 * Start (or resume) a model download.
 *
 * The route resolves the model, hands it to the sidecar and returns a job id.
 * There's no client-side queue any more — the sidecar caps concurrency, so a
 * request made while two downloads are already running waits in *its* queue and
 * survives a refresh, which the old in-memory queue could not.
 */
export function startDownload(opts: {
  modelId: string;
  modelName: string;
  variantId?: string;
}): AppThunk<Promise<void>> {
  return async (dispatch) => {
    dispatch(setModelStatus({ modelId: opts.modelId, status: 'downloading' }));

    let started: { jobId: string; targetDir: string };
    try {
      started = await fetchJson<{ jobId: string; targetDir: string }>(
        '/api/model-manager/download',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            modelId: opts.modelId,
            variantId: opts.variantId,
          }),
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Download failed';
      dispatch(setModelStatus({ modelId: opts.modelId, status: 'error' }));
      dispatch(
        addToast({
          variant: 'error',
          children: `Could not start the download: ${message}`,
        }),
      );
      return;
    }

    dispatch(
      addJob({
        id: started.jobId,
        type: 'download',
        status: 'pending',
        createdAt: Date.now(),
        startedAt: null,
        completedAt: null,
        error: null,
        modelId: opts.modelId,
        modelName: opts.modelName,
        targetDir: started.targetDir ?? '',
        progress: null,
      }),
    );
    liveJobs.add(started.jobId);
    dispatch(openPanel());

    ensureDownloadSocket(dispatch, await sidecarPort());
  };
}

/**
 * Ask the sidecar to stop a download. The partial stays on disk, so a later
 * Retry resumes from where it left off rather than starting over.
 */
export function cancelDownload(jobId: string): AppThunk<Promise<void>> {
  return async (dispatch) => {
    try {
      await fetchJson(
        `/api/model-manager/downloads/${encodeURIComponent(jobId)}/cancel`,
        { method: 'POST' },
      );
    } catch (err) {
      // The sidecar is the only thing that can stop the transfer, so a failure
      // here means it really is still running — don't fake a cancelled card.
      const message = err instanceof Error ? err.message : 'Cancel failed';
      dispatch(
        addToast({
          variant: 'error',
          children: `Could not cancel the download: ${message}`,
        }),
      );
    }
  };
}

/**
 * Clear a terminal download's record from the sidecar and drop its card.
 * Files on disk are untouched.
 */
export function clearDownload(jobId: string): AppThunk<Promise<void>> {
  return async (dispatch) => {
    dispatch(removeJob(jobId));
    try {
      await fetchJson(
        `/api/model-manager/downloads/${encodeURIComponent(jobId)}/clear`,
        { method: 'POST' },
      );
    } catch {
      // The card is already gone locally; a stale record just means the next
      // resync brings it back, which is the honest state.
    }
  };
}

/**
 * Clear every terminal download record, backing the panel's "Clear all".
 *
 * The local `clearCompletedJobs` reducer alone isn't enough: the sidecar's
 * records are the source of truth, so anything left there walks straight back
 * into the panel on the next resync.
 */
export function clearTerminalDownloads(): AppThunk<Promise<void>> {
  return async (dispatch, getState) => {
    const terminal = Object.values(getState().jobs.jobs).filter(
      (job): job is DownloadJob =>
        job.type === 'download' &&
        (job.status === 'completed' ||
          job.status === 'failed' ||
          job.status === 'cancelled' ||
          job.status === 'interrupted'),
    );
    await Promise.all(terminal.map((job) => dispatch(clearDownload(job.id))));
  };
}

/** Retry a failed or cancelled download — resumes from the bytes on disk. */
export function retryDownload(job: DownloadJob): AppThunk<Promise<void>> {
  return async (dispatch) => {
    // Retire the old record first, or the resync that follows the new
    // download's socket open would resurrect its card alongside the new one.
    await dispatch(clearDownload(job.id));
    await dispatch(
      startDownload({ modelId: job.modelId, modelName: job.modelName }),
    );
  };
}

/** Delete a download's partial files and forget the job entirely. */
export function removeDownload(job: DownloadJob): AppThunk<Promise<void>> {
  return async (dispatch) => {
    let deletedPaths: string[] = [];
    try {
      const { deletedPaths: deleted } = await fetchJson<{
        deletedPaths?: string[];
      }>('/api/model-manager/download', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: job.modelId }),
      });
      deletedPaths = deleted ?? [];
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Delete failed';
      dispatch(
        addToast({
          variant: 'error',
          children: `Could not delete the files: ${message}`,
        }),
      );
      return;
    }
    await dispatch(clearDownload(job.id));
    dispatch(setModelStatus({ modelId: job.modelId, status: 'not_installed' }));
    // Same cleanup as an uninstall: a default pointing at deleted bytes
    // would leave the model claiming to be ready.
    void dispatch(forgetDeletedModelFiles(job.modelId, deletedPaths));
  };
}

/**
 * Recover downloads on app mount.
 *
 * Everything the sidecar knows about is folded in — including transfers this
 * browser never started, and ones it resumed by itself on boot after an
 * interrupted session. The socket only opens when something is still in
 * flight; a list of purely terminal records needs no stream.
 */
export function hydrateDownloads(): AppThunk<Promise<void>> {
  return async (dispatch) => {
    await resyncDownloads(dispatch);
    if (liveJobs.size === 0) return;

    ensureDownloadSocket(dispatch, await sidecarPort());
    // Surface the panel so a resumed download isn't invisible after a refresh.
    dispatch(openPanel());
  };
}
