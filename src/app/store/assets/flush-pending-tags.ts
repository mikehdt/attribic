/**
 * Thunk to flush pending auto-tagger results from localStorage into Redux.
 *
 * Called after tagging completes (if the project is loaded) and after
 * project asset loading finishes (to reconcile results that arrived
 * while the user was away from the project).
 *
 * Handles both ONNX tag results (applied as TO_ADD tags) and VLM caption
 * results (applied as captionText, which is dirty until the user saves).
 */

import {
  getPendingTagResults,
  type PendingTagResult,
  setPendingTagResults,
} from '@/app/services/auto-tagger/pending-tag-results';

import type { AppThunk } from '../index';
import { addMultipleTags, setCaptionText } from './index';

/**
 * Read pending results from localStorage and apply them to loaded assets.
 * Only clears results that were successfully applied. If the project isn't
 * loaded (assets not in store), unflushed results remain in localStorage
 * for reconciliation when the user returns.
 *
 * Returns whether the flush ran against the right project — false means every
 * result was left staged and callers must not act on them either (deselecting
 * by fileId, say).
 */
export function flushPendingTagResults(
  projectFolderName: string,
): AppThunk<boolean> {
  return (dispatch, getState) => {
    const { imageIndexById, loadedProject } = getState().assets;

    // A batch's SSE loop deliberately survives navigation, so this can run
    // while a different project's assets fill the store. `fileId` is only
    // project-relative (`001`, `img_0001`, …), so without this check the
    // colliding ids would take another project's captions — and lose them from
    // this project's store in the same breath.
    if (loadedProject !== projectFolderName) return false;

    const results = getPendingTagResults(projectFolderName);
    if (results.length === 0) return true;

    const remaining: PendingTagResult[] = [];

    for (const result of results) {
      const assetLoaded = imageIndexById[result.fileId] !== undefined;
      const hasTags = result.tags && result.tags.length > 0;
      const hasCaption = result.caption && result.caption.length > 0;

      if (!hasTags && !hasCaption) continue;

      if (!assetLoaded) {
        // Project not loaded — keep for later reconciliation
        remaining.push(result);
        continue;
      }

      if (hasTags) {
        dispatch(
          addMultipleTags({
            assetId: result.fileId,
            tagNames: result.tags!,
            position: result.position,
          }),
        );
      }

      if (hasCaption) {
        dispatch(
          setCaptionText({
            assetId: result.fileId,
            text: result.caption!,
          }),
        );
      }
    }

    setPendingTagResults(projectFolderName, remaining);
    return true;
  };
}
