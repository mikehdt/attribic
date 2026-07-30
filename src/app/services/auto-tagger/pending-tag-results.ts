/**
 * Persistence for pending auto-tagger results across navigation.
 *
 * When auto-tagging runs, results are written here as they stream in.
 * A flush reads them back, dispatches to Redux, and clears storage.
 * This lets tagging continue in the background when the user navigates
 * away from the project — results are reconciled on return.
 */

const STORAGE_PREFIX = 'img-tagger:pending-tags:';

/**
 * How long an unflushed result is worth keeping. Results are keyed by bare
 * `fileId` (the project-relative path minus extension), so a result for an
 * image that has since been deleted or renamed waits forever — and a *new*
 * image that later takes the same name silently inherits it. A week is long
 * enough to cover "ran a batch, came back to the project next weekend" and
 * short enough that nothing inherits tags it never earned.
 */
const PENDING_RESULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type PendingTagResult = {
  fileId: string;
  position: 'start' | 'end';
  /** ONNX tagger result — tag names to append/prepend */
  tags?: string[];
  /** VLM captioner result — natural-language caption text */
  caption?: string;
  /** `Date.now()` when this result was staged — drives TTL expiry on read. */
  stagedAt?: number;
};

/**
 * Append a single result for a project. Called per-image during the SSE stream.
 *
 * Keyed by `fileId`: a second result for the same image replaces the first
 * rather than stacking. That makes a reattach's full replay idempotent, so the
 * staged copy never has to be wiped before an attach that might not land — and
 * summaries can't double-count the overlap.
 */
export function appendPendingTagResult(
  projectFolderName: string,
  result: PendingTagResult,
): void {
  const key = STORAGE_PREFIX + projectFolderName;
  try {
    const existing: PendingTagResult[] = JSON.parse(
      localStorage.getItem(key) || '[]',
    );
    const stamped = { ...result, stagedAt: Date.now() };
    const index = existing.findIndex((r) => r.fileId === result.fileId);
    if (index === -1) {
      existing.push(stamped);
    } else {
      existing[index] = stamped;
    }
    localStorage.setItem(key, JSON.stringify(existing));
  } catch {
    // localStorage unavailable (SSR, private browsing quota)
  }
}

/**
 * Read all pending results for a project, dropping any that have aged out.
 *
 * Expiry happens on read (and rewrites storage when it bites) because there's
 * no other pass over this data — a project the user never revisits would keep
 * its stale results forever otherwise.
 */
export function getPendingTagResults(
  projectFolderName: string,
): PendingTagResult[] {
  const key = STORAGE_PREFIX + projectFolderName;
  try {
    const stored: PendingTagResult[] = JSON.parse(
      localStorage.getItem(key) || '[]',
    );
    const now = Date.now();
    let changed = false;

    const live = stored.filter((result) => {
      if (typeof result.stagedAt !== 'number') {
        // Staged before this field existed — start its clock now rather than
        // expiring a result that might still be wanted.
        result.stagedAt = now;
        changed = true;
        return true;
      }
      if (now - result.stagedAt < PENDING_RESULT_TTL_MS) return true;
      changed = true;
      return false;
    });

    if (changed) setPendingTagResults(projectFolderName, live);
    return live;
  } catch {
    return [];
  }
}

/** Replace all pending results for a project (used to keep unflushed items). */
export function setPendingTagResults(
  projectFolderName: string,
  results: PendingTagResult[],
): void {
  const key = STORAGE_PREFIX + projectFolderName;
  try {
    if (results.length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(results));
    }
  } catch {
    // noop
  }
}

/** Clear all pending results for a project (after successful flush). */
export function clearPendingTagResults(projectFolderName: string): void {
  setPendingTagResults(projectFolderName, []);
}

/**
 * Compute a summary from the pending results (before flushing).
 * Used to populate the job's summary when tagging completes.
 * Counts both ONNX tag results and VLM caption results.
 */
export function summarisePendingResults(projectFolderName: string): {
  imagesProcessed: number;
  imagesWithNewTags: number;
  totalTagsFound: number;
} {
  const results = getPendingTagResults(projectFolderName);
  return {
    imagesProcessed: results.length,
    imagesWithNewTags: results.filter(
      (r) =>
        (r.tags && r.tags.length > 0) || (r.caption && r.caption.length > 0),
    ).length,
    totalTagsFound: results.reduce(
      (sum, r) => sum + (r.tags?.length ?? 0) + (r.caption ? 1 : 0),
      0,
    ),
  };
}
