/**
 * Node-side client for the Python sidecar's captioning endpoints.
 *
 * Spins up the sidecar if needed, calls /caption or /caption/batch,
 * and streams batch progress via the /ws/caption WebSocket.
 *
 * Batches are sidecar-authoritative: the sidecar stores per-image results
 * for the whole batch lifetime, so a client that lost its connection can
 * reattach via `attachCaptionBatch` and replay everything it missed.
 */

import {
  connectSidecar,
  ensureSidecar,
} from '@/app/services/training/sidecar-manager';

import { getModelDir, getModelFilePath } from '../../model-manager';
import type { TaggerModel, VlmOptions, VlmRuntime } from '../../types';
import { VLM_VIDEO_QUALITY_PIXELS } from '../../types';

/**
 * Build the `video` block for a sidecar caption request from the user's
 * VlmOptions. Always sent — the sidecar ignores it on image paths.
 * The Node side maps the `quality` preset to a concrete `max_pixels`
 * value here so the sidecar doesn't need to know about preset names.
 */
const buildVideoBlock = (options: VlmOptions) => ({
  frame_budget: options.video.frameBudget,
  max_fps: options.video.maxFps,
  max_pixels: VLM_VIDEO_QUALITY_PIXELS[options.video.quality],
});

/** One image the batch should process, with the caller's opaque ID for it. */
export type CaptionBatchItem = {
  path: string;
  itemId: string;
};

type CaptionResult = {
  itemId: string;
  imagePath: string;
  caption: string;
};

type CaptionErrorEvent = {
  error: string;
  itemId?: string;
  imagePath?: string;
};

/** Model loading status yielded while the sidecar loads weights. */
type LoadingStatus = {
  loading: true;
  message: string;
  current: number;
  total: number;
};

/**
 * Emitted once when the sidecar transitions from "loading" to "running"
 * after a successful model load. The route translates this into a
 * progress event with current=0 so the UI clears its loading overlay
 * before the first image finishes captioning.
 */
type LoadingCompleteStatus = {
  loadingComplete: true;
};

/**
 * Emitted when the sidecar reports the batch was cancelled (queue removal
 * or a cancel from another client). The route forwards this as a
 * `cancelled` SSE event instead of a misleading `complete`.
 */
type CancelledStatus = {
  cancelled: true;
};

/** The batch is waiting in the sidecar's job queue behind other GPU work. */
type QueuedStatus = {
  queued: true;
  /** 1-indexed place in line. */
  position: number;
};

/** First event from `attachCaptionBatch` — where the batch stands right now. */
type SnapshotStatus = {
  snapshot: true;
  status: BatchStatus;
  current: number;
  total: number;
  position?: number;
};

type BatchEvent =
  | CaptionResult
  | CaptionErrorEvent
  | LoadingStatus
  | LoadingCompleteStatus
  | CancelledStatus
  | QueuedStatus;

type BatchStatus =
  | 'queued'
  | 'loading'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Shape as sent by the Python sidecar (snake_case fields from Pydantic). */
type RawBatchProgressEvent = {
  channel?: string;
  batch_id: string;
  current: number;
  total: number;
  image_path?: string | null;
  item_id?: string | null;
  caption?: string | null;
  status: BatchStatus;
  error?: string | null;
  message?: string | null;
  queue_position?: number | null;
};

/** Normalized shape used by the rest of the Node code (camelCase). */
type BatchProgressEvent = {
  batchId: string;
  current: number;
  total: number;
  imagePath?: string;
  itemId?: string;
  caption?: string;
  status: BatchStatus;
  error?: string;
  message?: string;
  queuePosition?: number;
};

function normalizeEvent(raw: RawBatchProgressEvent): BatchProgressEvent {
  return {
    batchId: raw.batch_id,
    current: raw.current,
    total: raw.total,
    imagePath: raw.image_path ?? undefined,
    itemId: raw.item_id ?? undefined,
    caption: raw.caption ?? undefined,
    status: raw.status,
    error: raw.error ?? undefined,
    message: raw.message ?? undefined,
    queuePosition: raw.queue_position ?? undefined,
  };
}

/** Snapshot returned by GET /caption/batch/{id}. */
type BatchSnapshot = {
  batch_id: string;
  status: BatchStatus;
  current: number;
  total: number;
  project: string | null;
  error: string | null;
  queue_position: number;
  results: {
    item_id: string;
    image_path: string;
    caption?: string | null;
    error?: string | null;
  }[];
};

/** Listing entry returned by GET /caption/batches. */
export type BatchListEntry = {
  batch_id: string;
  status: BatchStatus;
  current: number;
  total: number;
  project: string | null;
  model_path: string | null;
  queue_position: number;
  result_count: number;
};

/**
 * Resolve the path the sidecar should load.
 *
 * - llama-cpp runtime: GGUF models have a single primary weights file; we
 *   return its absolute path. The sidecar opens that file directly.
 * - transformers runtime: safetensors releases are a *directory* of files
 *   (config.json, tokenizer, weight shards). We return the model directory
 *   so `from_pretrained(dir)` picks up everything.
 */
function getVlmModelPath(model: TaggerModel): string {
  if (model.files.length === 0) {
    throw new Error(`VLM model ${model.id} has no files defined`);
  }
  if (model.runtime === 'transformers') {
    return getModelDir(model);
  }
  return getModelFilePath(model, model.files[0].name);
}

/** The runtime the sidecar should use to load this model. */
function getRuntime(model: TaggerModel): VlmRuntime {
  return model.runtime ?? 'llama-cpp';
}

// ---------------------------------------------------------------------------
// WebSocket plumbing shared by the start and attach generators
// ---------------------------------------------------------------------------

type CaptionSocket = {
  waitOpen(): Promise<void>;
  /** Next event for this batch, or null when the socket errors/closes. */
  next(): Promise<BatchProgressEvent | null>;
  close(): void;
  takeError(): Error | null;
};

/**
 * Open the caption progress WebSocket, filtered to a single batch.
 * The sidecar broadcasts every batch's events to every connected client —
 * with queueing, another batch can be running while ours is queued, so
 * events not addressed to our batch are dropped here.
 */
function openCaptionSocket(port: number, batchId: string): CaptionSocket {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/caption`);

  const queue: BatchProgressEvent[] = [];
  let resolveNext: ((value: BatchProgressEvent | null) => void) | null = null;
  let wsOpen = false;
  let wsError: Error | null = null;

  ws.addEventListener('open', () => {
    wsOpen = true;
  });

  ws.addEventListener('message', (event) => {
    const raw =
      typeof event.data === 'string'
        ? event.data
        : // Coerce Buffer/ArrayBuffer/Blob to string as a safety net
          String(event.data);
    try {
      const parsed = JSON.parse(raw) as RawBatchProgressEvent;
      if (parsed.channel !== 'caption') return;
      if (parsed.batch_id !== batchId) return;
      const data = normalizeEvent(parsed);
      if (resolveNext) {
        resolveNext(data);
        resolveNext = null;
      } else {
        queue.push(data);
      }
    } catch (err) {
      console.warn('[vlm-client] parse error:', err);
    }
  });

  ws.addEventListener('error', () => {
    wsError = new Error('WebSocket error');
    if (resolveNext) {
      resolveNext(null);
      resolveNext = null;
    }
  });

  ws.addEventListener('close', () => {
    if (resolveNext) {
      resolveNext(null);
      resolveNext = null;
    }
  });

  return {
    waitOpen: () =>
      new Promise<void>((resolve, reject) => {
        if (wsOpen) return resolve();
        if (wsError) return reject(wsError);
        const timeout = setTimeout(() => {
          reject(new Error('WebSocket connection timed out'));
        }, 5000);
        ws.addEventListener(
          'open',
          () => {
            clearTimeout(timeout);
            resolve();
          },
          { once: true },
        );
        ws.addEventListener(
          'error',
          () => {
            clearTimeout(timeout);
            reject(new Error('WebSocket connection failed'));
          },
          { once: true },
        );
      }),
    next: () => {
      const buffered = queue.shift();
      if (buffered) return Promise.resolve(buffered);
      return new Promise<BatchProgressEvent | null>((resolve) => {
        resolveNext = resolve;
      });
    },
    close: () => ws.close(),
    takeError: () => wsError,
  };
}

/**
 * Translate this batch's WebSocket events into yielded batch events until a
 * terminal status arrives. `seenItems` skips per-image events that were
 * already replayed from a snapshot (attach path); it accumulates as live
 * events arrive so an overlap between snapshot and stream can't double-yield.
 */
async function* consumeSocket(
  socket: CaptionSocket,
  seenItems: Set<string>,
): AsyncGenerator<BatchEvent> {
  while (true) {
    const event = await socket.next();

    // A null means the WebSocket errored or closed. Before a terminal
    // status arrives that is always a failure — treating it as a clean
    // end made a sidecar crash mid-batch look like a successful run.
    if (event === null) {
      throw (
        socket.takeError() ??
        new Error('Sidecar connection closed before the batch finished')
      );
    }

    if (event.status === 'queued') {
      yield { queued: true, position: event.queuePosition ?? 1 };
      continue;
    }

    // Loading progress — yield a discriminated shape the route can
    // forward as an SSE `loading` event without confusing with results.
    if (event.status === 'loading') {
      yield {
        loading: true,
        message: event.message ?? 'Loading model',
        current: event.current,
        total: event.total,
      };
      continue;
    }

    // "Running" transition with no image payload: sent by the sidecar
    // immediately after model load completes, before the first image is
    // captioned. Signals the UI to drop its loading overlay.
    if (
      event.status === 'running' &&
      !event.imagePath &&
      event.caption === undefined &&
      !event.error
    ) {
      yield { loadingComplete: true };
      continue;
    }

    // Per-image events already delivered via snapshot replay.
    if (
      event.status === 'running' &&
      event.itemId &&
      seenItems.has(event.itemId)
    ) {
      continue;
    }

    // Per-image errors
    if (event.error && event.status === 'running') {
      if (event.itemId) seenItems.add(event.itemId);
      yield {
        error: event.error,
        itemId: event.itemId,
        imagePath: event.imagePath,
      };
      continue;
    }

    // Per-image success. Caption checked against undefined, not truthiness —
    // an empty-string caption is still one image's event, and dropping it
    // would desync completion counting.
    if (
      event.imagePath &&
      event.caption !== undefined &&
      event.status === 'running'
    ) {
      if (event.itemId) seenItems.add(event.itemId);
      yield {
        itemId: event.itemId ?? event.imagePath,
        imagePath: event.imagePath,
        caption: event.caption,
      };
      continue;
    }

    // Terminal states
    if (event.status === 'failed') {
      throw new Error(event.error ?? 'Caption batch failed');
    }
    if (event.status === 'cancelled') {
      yield { cancelled: true };
      return;
    }
    if (event.status === 'completed') {
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Public generators
// ---------------------------------------------------------------------------

/**
 * Start a batch caption run on the sidecar and stream progress back.
 * Returns an async generator yielding per-image results keyed by the
 * caller's item IDs, plus queued/loading/cancelled status events.
 *
 * The caller (API route) translates them into SSE events for the browser.
 */
export async function* captionBatchViaSidecar(
  model: TaggerModel,
  items: CaptionBatchItem[],
  options: VlmOptions,
  batchId: string,
  project?: string,
): AsyncGenerator<BatchEvent> {
  const sidecar = await ensureSidecar();
  if (sidecar.status !== 'ready') {
    throw new Error(`Sidecar not ready: ${sidecar.error ?? 'unknown error'}`);
  }

  const modelPath = getVlmModelPath(model);
  const runtime = getRuntime(model);

  // Open the WebSocket first so we don't miss early progress events
  // (the queued broadcast fires as soon as the batch is enqueued).
  const socket = openCaptionSocket(sidecar.port, batchId);

  try {
    await socket.waitOpen();

    // Kick off the batch on the sidecar
    const startRes = await fetch(
      `http://127.0.0.1:${sidecar.port}/caption/batch`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch_id: batchId,
          image_paths: items.map((i) => i.path),
          item_ids: items.map((i) => i.itemId),
          project,
          model_path: modelPath,
          runtime,
          prompt: options.prompt,
          max_tokens: options.maxTokens,
          temperature: options.temperature,
          video: buildVideoBlock(options),
        }),
      },
    );

    if (!startRes.ok) {
      const errBody = await startRes
        .json()
        .catch(() => ({ error: startRes.statusText }));
      throw new Error(
        errBody.error || `Sidecar batch start failed: ${startRes.status}`,
      );
    }

    yield* consumeSocket(socket, new Set());
  } finally {
    socket.close();
  }
}

/**
 * Reattach to a batch this process didn't start (or lost its connection to):
 * yields a snapshot of where the batch stands, replays every per-image
 * result the sidecar accumulated, then streams live progress. For batches
 * that already ended, the replay is followed by the terminal outcome.
 *
 * Never spawns the sidecar — if it isn't running, the batch is gone.
 */
export async function* attachCaptionBatch(
  batchId: string,
): AsyncGenerator<BatchEvent | SnapshotStatus> {
  const sidecar = await connectSidecar();
  if (sidecar.status !== 'ready') {
    throw new Error('Sidecar is not running — the batch no longer exists');
  }

  // Open the socket BEFORE fetching the snapshot: events that land while
  // we read the snapshot are buffered, and the seen-set dedups the overlap.
  const socket = openCaptionSocket(sidecar.port, batchId);
  try {
    await socket.waitOpen();

    const res = await fetch(
      `http://127.0.0.1:${sidecar.port}/caption/batch/${encodeURIComponent(batchId)}`,
    );
    if (!res.ok) {
      throw new Error(
        res.status === 404
          ? 'Batch no longer exists on the sidecar'
          : `Failed to fetch batch snapshot: ${res.status}`,
      );
    }
    const snapshot = (await res.json()) as BatchSnapshot;

    yield {
      snapshot: true,
      status: snapshot.status,
      current: snapshot.current,
      total: snapshot.total,
      position:
        snapshot.queue_position > 0 ? snapshot.queue_position : undefined,
    };

    // Replay accumulated per-image outcomes.
    const seen = new Set<string>();
    for (const entry of snapshot.results) {
      seen.add(entry.item_id);
      if (entry.error != null) {
        yield {
          error: entry.error,
          itemId: entry.item_id,
          imagePath: entry.image_path,
        };
      } else {
        yield {
          itemId: entry.item_id,
          imagePath: entry.image_path,
          caption: entry.caption ?? '',
        };
      }
    }

    // Already terminal — nothing further will be broadcast.
    if (snapshot.status === 'completed') return;
    if (snapshot.status === 'cancelled') {
      yield { cancelled: true };
      return;
    }
    if (snapshot.status === 'failed') {
      throw new Error(snapshot.error ?? 'Caption batch failed');
    }

    yield* consumeSocket(socket, seen);
  } finally {
    socket.close();
  }
}

/**
 * List batches known to the sidecar, optionally filtered by project.
 * Returns an empty list when the sidecar isn't running (nothing survives it).
 */
export async function listCaptionBatches(
  project?: string,
): Promise<BatchListEntry[]> {
  const sidecar = await connectSidecar();
  if (sidecar.status !== 'ready') return [];

  const url = new URL(`http://127.0.0.1:${sidecar.port}/caption/batches`);
  if (project) url.searchParams.set('project', project);

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const body = (await res.json()) as { batches: BatchListEntry[] };
    return body.batches;
  } catch {
    return [];
  }
}

/**
 * Cancel an in-progress caption batch on the sidecar.
 * Never spawns the sidecar — if it isn't running, the batch is already gone.
 */
export async function cancelCaptionBatch(batchId: string): Promise<void> {
  const sidecar = await connectSidecar();
  if (sidecar.status !== 'ready') return;

  await fetch(
    `http://127.0.0.1:${sidecar.port}/caption/batch/${encodeURIComponent(batchId)}/cancel`,
    { method: 'POST' },
  ).catch(() => {
    // best-effort
  });
}

/**
 * Drop a terminal batch (and its stored results) from the sidecar after the
 * client has flushed the results. Best-effort.
 */
export async function clearCaptionBatch(batchId: string): Promise<void> {
  const sidecar = await connectSidecar();
  if (sidecar.status !== 'ready') return;

  await fetch(
    `http://127.0.0.1:${sidecar.port}/caption/batch/${encodeURIComponent(batchId)}/clear`,
    { method: 'POST' },
  ).catch(() => {
    // best-effort
  });
}
