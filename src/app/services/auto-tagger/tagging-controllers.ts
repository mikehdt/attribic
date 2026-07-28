/**
 * Tracks AbortControllers for active tagging jobs.
 *
 * AbortControllers are not serializable and can't live in Redux.
 * This module provides a simple map for the UI and activity panel
 * to abort in-progress tagging jobs by job ID.
 */

const controllers = new Map<string, AbortController>();

/**
 * Batches this browser session has already taken ownership of — either by
 * reattaching to them or by cancelling them. The reattach sweep skips these:
 * two hook instances racing the same batch would double-apply its results,
 * and a batch the sidecar hasn't finished cancelling yet would otherwise be
 * re-adopted and flushed all over again.
 */
const adoptedBatchIds = new Set<string>();

export function markBatchAdopted(batchId: string): void {
  adoptedBatchIds.add(batchId);
}

export function hasBatchBeenAdopted(batchId: string): boolean {
  return adoptedBatchIds.has(batchId);
}

/** Register a controller for a tagging job. */
export function registerTaggingController(jobId: string): AbortController {
  controllers.get(jobId)?.abort();

  const controller = new AbortController();
  controllers.set(jobId, controller);
  return controller;
}

/** Abort a tagging job by ID. */
export function abortTagging(jobId: string): void {
  const controller = controllers.get(jobId);
  if (controller) {
    controller.abort();
    controllers.delete(jobId);
  }
}

/**
 * Cancel a tagging job end-to-end: abort the local SSE stream AND tell the
 * sidecar to stop the batch. Aborting alone no longer stops anything —
 * batches deliberately survive client disconnects so they can be reattached.
 * The job ID doubles as the sidecar batch ID. Harmless for ONNX jobs
 * (no sidecar batch exists; the cancel endpoint is best-effort).
 */
export function cancelTaggingJob(jobId: string): void {
  abortTagging(jobId);
  // Cancelling is ownership too — don't let the reattach sweep pick this
  // batch back up in the window before the sidecar has cleared it.
  markBatchAdopted(jobId);
  void (async () => {
    try {
      await fetch('/api/auto-tagger/batch/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: jobId }),
      });
    } catch {
      // best-effort — the sidecar may not be running
      return;
    }
    // Clear the stored batch once the cancel has landed, so /batch/active
    // doesn't resurface an already-flushed batch. Cancellation only takes
    // effect at the next image boundary, and one inference can run long —
    // the clear route 409s until the batch goes terminal, so poll rather
    // than guess a fixed delay.
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        const response = await fetch('/api/auto-tagger/batch/clear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batchId: jobId }),
        });
        if (response.ok) return;
        // 409 = still running; keep polling. Anything else won't self-heal.
        if (response.status !== 409) return;
      } catch {
        // transient network failure — retry until the deadline
      }
    }
    console.warn(
      `[tagging] Batch ${jobId} still running 60s after cancel; its stored state was not cleared`,
    );
  })();
}

/** Clean up a controller after tagging completes or fails. */
export function removeTaggingController(jobId: string): void {
  controllers.delete(jobId);
}
