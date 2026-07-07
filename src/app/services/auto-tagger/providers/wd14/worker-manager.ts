/**
 * Manager for the ONNX tagger worker thread.
 *
 * Spawns a single long-lived worker that caches the ONNX session
 * between requests. Requests are serialised — one image at a time —
 * because a single ONNX session isn't thread-safe for concurrent runs.
 *
 * The worker is spawned lazily on first request and persists until
 * explicitly terminated or the process exits.
 */

import path from 'path';
import { Worker } from 'worker_threads';

import type { TaggerModel, TaggerOptions, TaggerOutput } from '../../types';

// ---------------------------------------------------------------------------
// Worker lifecycle
// ---------------------------------------------------------------------------

let worker: Worker | null = null;
let workerReady = false;
let readyPromise: Promise<void> | null = null;

function getWorkerPath(): string {
  return path.join(process.cwd(), 'workers', 'onnx-tagger.js');
}

function spawnWorker(): Worker {
  const w = new Worker(getWorkerPath(), {
    workerData: { appRoot: process.cwd() },
  });

  w.on('error', (err) => {
    console.error('[onnx-worker] Worker error:', err);
    worker = null;
    workerReady = false;
    readyPromise = null;
  });

  w.on('exit', (code) => {
    if (code !== 0) {
      console.warn(`[onnx-worker] Worker exited with code ${code}`);
    }
    worker = null;
    workerReady = false;
    readyPromise = null;
  });

  return w;
}

function ensureWorker(): Promise<Worker> {
  if (worker && workerReady) {
    return Promise.resolve(worker);
  }

  if (worker && readyPromise) {
    return readyPromise.then(() => worker!);
  }

  // Spawn a fresh worker
  worker = spawnWorker();
  workerReady = false;

  readyPromise = new Promise<void>((resolve, reject) => {
    const onMessage = (msg: { type: string }) => {
      if (msg.type === 'ready') {
        workerReady = true;
        worker!.off('message', onMessage);
        worker!.off('error', onError);
        resolve();
      }
    };
    const onError = (err: Error) => {
      worker!.off('message', onMessage);
      reject(err);
    };
    worker!.on('message', onMessage);
    worker!.once('error', onError);
  });

  return readyPromise.then(() => worker!);
}

// ---------------------------------------------------------------------------
// Request queue — serialise inference requests to the single worker
// ---------------------------------------------------------------------------

type QueueEntry = {
  message: unknown;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

const queue: QueueEntry[] = [];
let processing = false;

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    const entry = queue.shift()!;
    try {
      const w = await ensureWorker();
      const result = await sendMessage(w, entry.message);
      entry.resolve(result);
    } catch (err) {
      entry.reject(err);
    }
  }

  processing = false;
}

function sendMessage(
  w: Worker,
  msg: unknown,
): Promise<{ type: string; [key: string]: unknown }> {
  return new Promise((resolve, reject) => {
    const onMessage = (response: { type: string; error?: string }) => {
      w.off('message', onMessage);
      w.off('error', onError);

      if (response.type === 'error') {
        reject(new Error(response.error || 'Worker error'));
      } else {
        resolve(response);
      }
    };
    const onError = (err: Error) => {
      w.off('message', onMessage);
      reject(err);
    };

    w.on('message', onMessage);
    w.once('error', onError);
    w.postMessage(msg);
  });
}

function enqueue(message: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    queue.push({ message, resolve, reject });
    processQueue();
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Tag a single image using the worker thread.
 * Returns the same TaggerOutput shape as the direct inference function.
 */
export async function tagImageInWorker(
  model: TaggerModel,
  imagePath: string,
  options: TaggerOptions,
): Promise<TaggerOutput> {
  const response = (await enqueue({
    type: 'tag',
    provider: model.provider,
    modelId: model.id,
    imagePath,
    options,
  })) as { type: string; tags: TaggerOutput };

  return response.tags;
}
