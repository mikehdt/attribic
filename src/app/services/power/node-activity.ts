/**
 * Tracks work running inside *this* Node process, so the sidecar's keep-awake
 * ticker can see it.
 *
 * The sidecar owns the sleep inhibition (it's the one process that can hold an
 * OS-level lock without a native dependency — see training-sidecar/power.py),
 * and it can see its own training jobs, caption batches and downloads. What it
 * can't see is ONNX/WD14 tagging: those batches run in the Next process. A
 * long auto-tag run would otherwise look like an idle machine and get slept
 * through. This module is the bridge — Node reports `busy` on its heartbeat.
 *
 * Server-only. Counted rather than boolean so overlapping batches can't have
 * the first one to finish clear the flag for the others.
 */

let activeCount = 0;

/** Whether this process has work that should keep the machine awake. */
export function hasNodeActivity(): boolean {
  return activeCount > 0;
}

/**
 * Mark the start of a keep-awake-worthy run. Pushes a heartbeat immediately
 * rather than waiting out the 30s interval — a screensaver can engage inside
 * one, and there's no point reporting the batch a third of the way in.
 */
export function beginNodeActivity(): void {
  activeCount += 1;
  if (activeCount === 1) notifySidecar();
}

/** Mark the end of a run started with {@link beginNodeActivity}. */
export function endNodeActivity(): void {
  if (activeCount === 0) return;
  activeCount -= 1;
  if (activeCount === 0) notifySidecar();
}

/**
 * Imported lazily so this module stays free of the sidecar manager's
 * child_process/fs surface — the tagging path shouldn't drag process
 * management in just to count a batch.
 */
function notifySidecar(): void {
  void import('@/app/services/training/sidecar-manager')
    .then((m) => m.pingSidecarActivity())
    .catch(() => {
      // Best-effort: the next scheduled heartbeat carries the same state.
    });
}
