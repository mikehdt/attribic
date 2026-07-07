/**
 * Persistence for pending auto-tagger results across navigation.
 *
 * When auto-tagging runs, results are written here as they stream in.
 * A flush reads them back, dispatches to Redux, and clears storage.
 * This lets tagging continue in the background when the user navigates
 * away from the project — results are reconciled on return.
 */

const STORAGE_PREFIX = 'img-tagger:pending-tags:';

export type PendingTagResult = {
  fileId: string;
  position: 'start' | 'end';
  /** ONNX tagger result — tag names to append/prepend */
  tags?: string[];
  /** VLM captioner result — natural-language caption text */
  caption?: string;
};

/** Append a single result for a project. Called per-image during the SSE stream. */
export function appendPendingTagResult(
  projectFolderName: string,
  result: PendingTagResult,
): void {
  const key = STORAGE_PREFIX + projectFolderName;
  try {
    const existing: PendingTagResult[] = JSON.parse(
      localStorage.getItem(key) || '[]',
    );
    existing.push(result);
    localStorage.setItem(key, JSON.stringify(existing));
  } catch {
    // localStorage unavailable (SSR, private browsing quota)
  }
}

/** Read all pending results for a project. */
export function getPendingTagResults(
  projectFolderName: string,
): PendingTagResult[] {
  const key = STORAGE_PREFIX + projectFolderName;
  try {
    return JSON.parse(localStorage.getItem(key) || '[]');
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
