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

import { getModelsFolder } from '@/app/services/config/server-config';

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
    workerData: { modelsDir: getModelsFolder() },
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
  const w = (worker = spawnWorker());
  workerReady = false;

  readyPromise = new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      w.off('message', onMessage);
      w.off('error', onError);
      w.off('exit', onExit);
    };
    const onMessage = (msg: { type: string }) => {
      if (msg.type === 'ready') {
        workerReady = true;
        cleanup();
        resolve();
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    // A native crash (onnxruntime/sharp abort, process.exit in the worker)
    // emits `exit` without `error` — without this the ready promise would
    // stay pending forever and wedge the request queue.
    const onExit = (code: number) => {
      cleanup();
      reject(new Error(`ONNX worker exited before ready (code ${code})`));
    };
    w.on('message', onMessage);
    w.once('error', onError);
    w.once('exit', onExit);
  });

  return readyPromise.then(() => w);
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
    const cleanup = () => {
      w.off('message', onMessage);
      w.off('error', onError);
      w.off('exit', onExit);
    };
    const onMessage = (response: { type: string; error?: string }) => {
      cleanup();

      if (response.type === 'error') {
        reject(new Error(response.error || 'Worker error'));
      } else {
        resolve(response);
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    // Mid-inference native crashes emit `exit` without `error`; settle the
    // request so the queue can move on and respawn a fresh worker.
    const onExit = (code: number) => {
      cleanup();
      reject(new Error(`ONNX worker exited mid-request (code ${code})`));
    };

    w.on('message', onMessage);
    w.once('error', onError);
    w.once('exit', onExit);
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

/**
 * Release every cached ONNX session, freeing the GPU/CPU memory they hold.
 *
 * Goes through the same queue as tagging, so it can never evict a session
 * out from under an in-flight inference — it lands once the worker is idle.
 * The worker itself stays alive; it's cheap when idle and respawning costs
 * more than it saves.
 *
 * Returns false when no worker is running: there is nothing to release, and
 * spawning one purely to unload it would be pointless work.
 */
export async function unloadWorkerModels(): Promise<boolean> {
  if (!worker) return false;

  await enqueue({ type: 'unload' });
  return true;
}
