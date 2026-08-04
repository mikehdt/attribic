import { useCallback } from 'react';
import { useDispatch } from 'react-redux';

import type { ProviderType } from '@/app/services/auto-tagger';
import {
  getPendingTagResults,
  summarisePendingResults,
} from '@/app/services/auto-tagger/pending-tag-results';
import type { AppDispatch } from '@/app/store';
import { flushPendingTagResults } from '@/app/store/assets/flush-pending-tags';
import { completeTagging, failTagging } from '@/app/store/jobs';
import { setAssetsSelectionState } from '@/app/store/selection';

import type { TaggingJobRegistry } from './use-tagging-job-registry';

/**
 * How a batch ended, as far as this client is concerned. `failed` still flushes
 * whatever landed — the staged results are the only surviving copy once the
 * sidecar's copy dies with the error.
 */
type FinaliseOutcome =
  | { status: 'completed'; completionDelayMs?: number }
  | { status: 'cancelled' }
  | { status: 'failed'; error: string };

export type FlushAndFinalise = (
  projectFolderName: string,
  jobId: string,
  outcome: FinaliseOutcome,
) => Promise<void>;

type UseFlushAndFinaliseParams = {
  registry: TaggingJobRegistry;
  unselectOnComplete: boolean;
  selectedProviderType: ProviderType | undefined;
};

/**
 * Flush pending results from localStorage → Redux, deselect tagged assets,
 * drop the batch's stored copy, and record the job's terminal state. This is
 * the single mechanism for applying tags, whether tagging just completed or
 * the user returned to a project with pending results — and it runs for a
 * *failed* batch too, since whatever it managed to produce is worth keeping
 * and is the only copy left.
 */
export function useFlushAndFinalise({
  registry,
  unselectOnComplete,
  selectedProviderType,
}: UseFlushAndFinaliseParams): FlushAndFinalise {
  const dispatch = useDispatch<AppDispatch>();

  return useCallback(
    async (
      projectFolderName: string,
      jobId: string,
      outcome: FinaliseOutcome,
    ) => {
      // Compute summary from localStorage before flushing clears it.
      // Enrich with errorCount + providerType so the activity-panel card can
      // distinguish "partial success" from "fully successful" and choose
      // captioning vs tagging wording. Errors are read (synchronously, before
      // any await) from this job's own bucket — a concurrent batch has its own.
      const imageErrors = registry.getImageErrors(jobId);
      const baseSummary = summarisePendingResults(projectFolderName);
      const summaryData = {
        ...baseSummary,
        errorCount: imageErrors.length,
        errors: [...imageErrors],
        providerType: registry.getProviderType(jobId) ?? selectedProviderType,
      };

      // Which assets actually got something, read before the flush clears the
      // store. A cancelled run processes only part of the selection, so
      // deselecting the whole selection would drop assets that were never
      // touched — and they're exactly the ones the user needs to re-run.
      const taggedFileIds = getPendingTagResults(projectFolderName)
        .filter((r) => r.tags?.length || r.caption?.length)
        .map((r) => r.fileId);

      // Tell the sidecar to drop its stored copy of this batch — the results
      // are being flushed locally now, and /batch/active must not resurface
      // it for reattach (that would apply everything a second time). No-op
      // for ONNX jobs and when the sidecar is gone. On local cancels the
      // batch may still be mid-cancel (409); cancelTaggingJob retries later.
      // Failed batches are cleared here too, otherwise every refresh re-adopts
      // them, replays them, and fails them again.
      fetch('/api/auto-tagger/batch/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: jobId }),
      }).catch(() => {
        /* best-effort */
      });

      // Flush: read from localStorage → dispatch addMultipleTags → clear.
      // Refuses (leaving everything staged) when the loaded project isn't this
      // batch's — this loop outlives navigation, so that's a live possibility.
      const flushed = dispatch(flushPendingTagResults(projectFolderName));

      // Deselect assets that received tags. Only meaningful when the flush
      // actually applied to this project's assets; the ids would otherwise
      // address whatever project is loaded now.
      if (flushed && unselectOnComplete && taggedFileIds.length > 0) {
        dispatch(
          setAssetsSelectionState({
            assetIds: taggedFileIds,
            selected: false,
          }),
        );
      }

      if (outcome.status === 'cancelled') {
        // cancelTagging already dispatched by the abort handler
        return;
      }

      if (outcome.status === 'failed') {
        dispatch(
          failTagging({
            id: jobId,
            error: outcome.error,
            summary: summaryData,
          }),
        );
        return;
      }

      // Optional pause between dispatching flush + summary state and the final
      // `completeTagging`. Lets the progress bar render at 100% for a beat
      // before the modal flips to the summary view; otherwise the last image's
      // "done" frame is invisible.
      const completionDelayMs = outcome.completionDelayMs ?? 0;
      if (completionDelayMs > 0) {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => setTimeout(resolve, completionDelayMs));
        });
        // If the user cancelled during the settle window, don't overwrite
        // their cancellation with a completed state.
        if (registry.isJobAborted(jobId)) return;
      }
      dispatch(completeTagging({ id: jobId, summary: summaryData }));
    },
    [dispatch, unselectOnComplete, selectedProviderType, registry],
  );
}
