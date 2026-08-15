/**
 * In-process registry for ONNX (WD14) batch runs.
 *
 * The VLM provider gets durability for free: its batches live in the Python
 * sidecar, which outlives the browser, so a refreshed client reattaches via
 * the snapshot endpoint. ONNX runs inside this Next process, so a refresh
 * used to lose the run entirely — the results only ever existed on the SSE
 * wire.
 *
 * This store gives ONNX batches the same shape the sidecar keeps for caption
 * batches: accumulated per-asset results plus a live event feed. Both
 * providers can then reattach through the same /batch/active + /batch/attach
 * path, and the client needs no per-provider branching.
 *
 * State is per-process and in-memory. A dev-server restart drops it, exactly
 * as a sidecar restart drops caption batches — durable across the browser's
 * lifetime, not the server's.
 */

import {
  beginNodeActivity,
  endNodeActivity,
} from '@/app/services/power/node-activity';

export type OnnxBatchStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/** One image's outcome, in processing order. Mirrors the sidecar's results[]. */
export type OnnxBatchResult = {
  itemId: string;
  /** Name of the file actually fed to the model (poster frame for videos). */
  fileName?: string;
  tags?: string[];
  error?: string;
};

/** Live feed events. Attached clients replay `results` first, then follow these. */
type OnnxBatchEvent =
  | { kind: 'result'; result: OnnxBatchResult }
  | { kind: 'terminal'; status: OnnxBatchStatus; error?: string };

type OnnxBatchState = {
  batchId: string;
  project?: string;
  modelName?: string;
  total: number;
  current: number;
  status: OnnxBatchStatus;
  /**
   * Set by a cancel request. The runner checks it between images — there's no
   * way to interrupt a single in-flight ONNX inference, so cancellation lands
   * at the next image boundary.
   */
  cancelRequested: boolean;
  /**
   * Per-image outcomes in processing order, kept for the whole batch lifetime
   * so a client that lost its stream (refresh, closed tab) can replay them.
   */
  results: OnnxBatchResult[];
  error?: string;
  listeners: Set<(event: OnnxBatchEvent) => void>;
};

const batches = new Map<string, OnnxBatchState>();

function emit(state: OnnxBatchState, event: OnnxBatchEvent): void {
  for (const listener of state.listeners) {
    try {
      listener(event);
    } catch {
      // A broken listener must never derail the run.
    }
  }
}

/**
 * Register a new batch. Refuses — returning false — when a batch with this ID
 * is still running: replacing its state would interleave two runners into one
 * object. Terminal (completed/failed/cancelled) batches may be replaced.
 */
export function createOnnxBatch(init: {
  batchId: string;
  project?: string;
  modelName?: string;
  total: number;
}): boolean {
  const existing = batches.get(init.batchId);
  if (existing && existing.status === 'running') return false;
  batches.set(init.batchId, {
    batchId: init.batchId,
    project: init.project,
    modelName: init.modelName,
    total: init.total,
    current: 0,
    status: 'running',
    cancelRequested: false,
    results: [],
    listeners: new Set(),
  });
  // Paired with the endNodeActivity in finishOnnxBatch, which is why that one
  // only fires on the running -> terminal edge. Tells the sidecar to hold the
  // machine awake: ONNX inference is invisible to it otherwise.
  beginNodeActivity();
  return true;
}

/** Record one image's outcome and advance the completion count. */
export function appendOnnxResult(
  batchId: string,
  result: OnnxBatchResult,
): void {
  const state = batches.get(batchId);
  if (!state) return;
  state.results.push(result);
  state.current = state.results.length;
  emit(state, { kind: 'result', result });
}

export function finishOnnxBatch(
  batchId: string,
  status: OnnxBatchStatus,
  error?: string,
): void {
  const state = batches.get(batchId);
  if (!state) return;
  const wasRunning = state.status === 'running';
  state.status = status;
  state.error = error;
  emit(state, { kind: 'terminal', status, error });
  // Only on the running -> terminal edge: a second finish call (a cancel
  // landing just after the loop completed, say) must not decrement twice and
  // release the keep-awake lock out from under another live batch.
  if (wasRunning) endNodeActivity();
}

/**
 * Ask a running batch to stop at the next image boundary. Returns false when
 * the batch isn't ours — the caller can then treat it as a VLM batch.
 */
export function requestOnnxCancel(batchId: string): boolean {
  const state = batches.get(batchId);
  if (!state) return false;
  state.cancelRequested = true;
  return true;
}

export function isOnnxCancelRequested(batchId: string): boolean {
  return batches.get(batchId)?.cancelRequested ?? false;
}

export function hasOnnxBatch(batchId: string): boolean {
  return batches.has(batchId);
}

/**
 * Drop a batch and its stored results once the client has flushed them.
 * Returns false — and keeps the batch — if it's still running: dropping it
 * would discard the cancel flag the runner is polling, and the loop would run
 * on to the end. Callers cancel first, then clear once it goes terminal.
 * (The sidecar refuses the same way, with a 409.)
 */
export function clearOnnxBatch(batchId: string): boolean {
  const state = batches.get(batchId);
  if (!state) return true;
  if (state.status === 'running') return false;
  batches.delete(batchId);
  return true;
}

/**
 * Batches for a project, newest last (insertion order). Terminal batches stay
 * listed until cleared so a client that missed the end still collects results.
 */
export function listOnnxBatches(project?: string): {
  batchId: string;
  status: OnnxBatchStatus;
  current: number;
  total: number;
  project?: string;
  modelName?: string;
  resultCount: number;
}[] {
  const out = [];
  for (const state of batches.values()) {
    if (project && state.project !== project) continue;
    out.push({
      batchId: state.batchId,
      status: state.status,
      current: state.current,
      total: state.total,
      project: state.project,
      modelName: state.modelName,
      resultCount: state.results.length,
    });
  }
  return out;
}

/** First event from `attachOnnxBatch` — where the batch stands right now. */
type OnnxSnapshot = {
  snapshot: true;
  status: OnnxBatchStatus;
  current: number;
  total: number;
};

type OnnxAttachEvent =
  OnnxSnapshot | { result: OnnxBatchResult } | { cancelled: true };

/**
 * Reattach to a batch this stream didn't start: yield a snapshot, replay every
 * stored per-image outcome, then follow live progress until the batch ends.
 *
 * Listener registration happens before the replay so results landing mid-replay
 * are buffered rather than dropped; the seen-set dedupes the overlap.
 */
export async function* attachOnnxBatch(
  batchId: string,
): AsyncGenerator<OnnxAttachEvent> {
  const state = batches.get(batchId);
  if (!state) {
    throw new Error('Batch no longer exists');
  }

  const queue: OnnxBatchEvent[] = [];
  let resolveNext: (() => void) | null = null;
  const listener = (event: OnnxBatchEvent) => {
    queue.push(event);
    resolveNext?.();
    resolveNext = null;
  };
  state.listeners.add(listener);

  try {
    yield {
      snapshot: true,
      status: state.status,
      current: state.current,
      total: state.total,
    };

    const seen = new Set<string>();
    for (const result of [...state.results]) {
      seen.add(result.itemId);
      yield { result };
    }

    // Already terminal — nothing further will be emitted.
    if (state.status === 'completed') return;
    if (state.status === 'cancelled') {
      yield { cancelled: true };
      return;
    }
    if (state.status === 'failed') {
      throw new Error(state.error ?? 'Batch failed');
    }

    while (true) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          resolveNext = resolve;
        });
      }
      const event = queue.shift();
      if (!event) continue;

      if (event.kind === 'result') {
        // Skip outcomes already covered by the replay above.
        if (seen.has(event.result.itemId)) continue;
        seen.add(event.result.itemId);
        yield { result: event.result };
        continue;
      }

      if (event.status === 'cancelled') {
        yield { cancelled: true };
        return;
      }
      if (event.status === 'failed') {
        throw new Error(event.error ?? 'Batch failed');
      }
      return;
    }
  } finally {
    state.listeners.delete(listener);
  }
}
