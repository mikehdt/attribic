/**
 * Client-side download starter + concurrency queue.
 *
 * Model files are large, so we cap how many download at once. Requests
 * beyond the cap are added to the jobs slice as `pending` (surfaced in the
 * activity panel's queued list) and promoted to running downloads as slots
 * free up.
 *
 * Each running download registers an AbortController, streams SSE progress,
 * and dispatches Redux actions. Used by both the model manager modal and the
 * activity panel's resume handler.
 */

import type { AppDispatch, RootState } from '@/app/store';
import {
  addJob,
  completeDownload,
  failDownload,
  updateDownloadProgress,
  updateJobStatus,
} from '@/app/store/jobs';
import { setModelStatus } from '@/app/store/model-manager';

import {
  registerDownloadController,
  removeDownloadController,
} from './download-controllers';

/**
 * Maximum downloads running at once. Extra requests queue as `pending` jobs
 * and start as slots free up. Kept low deliberately — model files are huge,
 * so more parallelism just splits bandwidth and thrashes the disk.
 */
const MAX_CONCURRENT_DOWNLOADS = 2;

type StartDownloadOpts = {
  modelId: string;
  modelName: string;
  variantId?: string;
  dispatch: AppDispatch;
  getState: () => RootState;
};

type QueuedDownload = {
  jobId: string;
  modelId: string;
  variantId?: string;
  dispatch: AppDispatch;
};

let activeCount = 0;
const queue: QueuedDownload[] = [];
// Captured from the most recent enqueue so `pump` can check whether a queued
// job is still pending (the user may have cancelled or removed it while it
// waited). The store is a per-session singleton, so this reference is stable.
let getState: (() => RootState) | null = null;

/**
 * Queue a model download. Returns the job ID immediately; the download itself
 * starts now if a concurrency slot is free, or later when one opens up.
 */
export function startModelDownload({
  modelId,
  modelName,
  variantId,
  dispatch,
  getState: getStateFn,
}: StartDownloadOpts): string {
  getState = getStateFn;

  const suffix = variantId ? `-${variantId}` : '';
  const jobId = `dl-${Date.now()}-${modelId}${suffix}`;

  dispatch(
    addJob({
      id: jobId,
      type: 'download',
      status: 'pending',
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      error: null,
      modelId,
      modelName,
      targetDir: '',
      progress: null,
    }),
  );

  queue.push({ jobId, modelId, variantId, dispatch });
  pump();

  return jobId;
}

/** Promote queued downloads to running until the concurrency cap is hit. */
function pump(): void {
  while (activeCount < MAX_CONCURRENT_DOWNLOADS && queue.length > 0) {
    const entry = queue.shift()!;

    // The job may have been cancelled or removed from the queue while it
    // waited — only start ones still marked pending.
    const job = getState?.().jobs.jobs[entry.jobId];
    if (!job || job.status !== 'pending') continue;

    activeCount++;
    void runDownload(entry).finally(() => {
      activeCount--;
      pump();
    });
  }
}

/** Stream a single download to completion, driving Redux from SSE events. */
async function runDownload({
  jobId,
  modelId,
  variantId,
  dispatch,
}: QueuedDownload): Promise<void> {
  dispatch(updateJobStatus({ id: jobId, status: 'running' }));
  dispatch(setModelStatus({ modelId, status: 'downloading' }));

  const controller = registerDownloadController(jobId);

  try {
    const res = await fetch('/api/model-manager/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId, variantId }),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) throw new Error('Failed to start download');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    // SSE lines can split across network chunks — carry the partial tail
    // over to the next read. Without this, a split `data:` line threw in
    // JSON.parse and the whole download surfaced as failed while the
    // server kept downloading.
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let data;
        try {
          data = JSON.parse(line.slice(6));
        } catch (parseErr) {
          console.warn('Failed to parse download SSE event:', line, parseErr);
          continue;
        }

        if (data.status === 'error') {
          dispatch(failDownload({ id: jobId, error: data.error }));
          dispatch(setModelStatus({ modelId, status: 'error' }));
          removeDownloadController(jobId);
          return;
        }

        if (data.status === 'ready') {
          dispatch(completeDownload(jobId));
          dispatch(setModelStatus({ modelId, status: 'ready' }));
          removeDownloadController(jobId);
          return;
        }

        dispatch(
          updateDownloadProgress({
            id: jobId,
            progress: {
              bytesDownloaded: data.bytesDownloaded,
              totalBytes: data.totalBytes,
              currentFile: data.currentFile,
              fileIndex: data.fileIndex,
              totalFiles: data.totalFiles,
            },
          }),
        );
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      dispatch(
        updateJobStatus({
          id: jobId,
          status: 'cancelled',
          error: 'Download cancelled',
        }),
      );
      dispatch(setModelStatus({ modelId, status: 'not_installed' }));
    } else {
      const msg = err instanceof Error ? err.message : 'Download failed';
      dispatch(failDownload({ id: jobId, error: msg }));
      dispatch(setModelStatus({ modelId, status: 'error' }));
    }
    removeDownloadController(jobId);
  }
}
