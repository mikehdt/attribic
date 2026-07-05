/**
 * Tracks AbortControllers for active tagging jobs.
 *
 * AbortControllers are not serializable and can't live in Redux.
 * This module provides a simple map for the UI and activity panel
 * to abort in-progress tagging jobs by job ID.
 */

const controllers = new Map<string, AbortController>();

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
  void (async () => {
    try {
      await fetch('/api/auto-tagger/batch/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: jobId }),
      });
      // The sidecar reaches 'cancelled' shortly after (its cancel check
      // aborts mid-image). Clear its stored batch once that has landed so
      // /batch/active doesn't resurface an already-flushed batch — the
      // immediate clear from the flush path 409s while the batch is still
      // mid-cancel.
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await fetch('/api/auto-tagger/batch/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: jobId }),
      });
    } catch {
      // best-effort — the sidecar may not be running
    }
  })();
}

/** Clean up a controller after tagging completes or fails. */
export function removeTaggingController(jobId: string): void {
  controllers.delete(jobId);
}
