import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';

import type { VlmOutputTarget } from '@/app/services/auto-tagger';
import { parseTagListOutput } from '@/app/services/auto-tagger';
import {
  appendPendingTagResult,
  summarisePendingResults,
} from '@/app/services/auto-tagger/pending-tag-results';
import { readTaggingSseEvents } from '@/app/services/auto-tagger/sse-stream';
import {
  hasBatchBeenAdopted,
  markBatchAdopted,
} from '@/app/services/auto-tagger/tagging-controllers';
import type { AppDispatch } from '@/app/store';
import {
  addJob,
  cancelTagging,
  recordTaggingResult,
  updateTaggingProgress,
} from '@/app/store/jobs';
import { getAutoTaggerSettings } from '@/app/utils/project-actions';

import type { FlushAndFinalise } from './use-flush-and-finalise';
import type { TaggingJobRegistry } from './use-tagging-job-registry';

/**
 * How many times the reattach sweep will try a single batch before giving up on
 * it for the session. More than one so a dev-server recompile or transient 500
 * during the attach fetch doesn't orphan a batch that's still running; bounded
 * so a batch that can never be attached doesn't re-fail on every sweep.
 */
const MAX_ATTACH_ATTEMPTS = 3;

type ActiveBatch = {
  batchId: string;
  current: number;
  total: number;
  modelName?: string;
  providerType?: 'vlm' | 'onnx';
};

type UseBatchReattachParams = {
  projectFolderName: string | undefined;
  projectName: string | undefined;
  /** The job id of a batch this client is already streaming, if any. */
  activeTaggingJobId: string | null;
  /**
   * What a VLM batch for this project produces, derived from its caption mode.
   * The original run's choice isn't recoverable after a refresh, but it was
   * itself derived the same way — so a tag-mode project's reattached VLM
   * results parse back into tags like the live stream's did.
   */
  vlmOutput: VlmOutputTarget;
  registry: TaggingJobRegistry;
  flushAndFinalise: FlushAndFinalise;
  setError: Dispatch<SetStateAction<string | null>>;
};

/**
 * Discover batches still being tracked for this project and reattach to them.
 * Runs itself — there's nothing to return, the reattached batch surfaces
 * through the jobs slice like any other.
 */
export function useBatchReattach({
  projectFolderName,
  projectName,
  activeTaggingJobId,
  vlmOutput,
  registry,
  flushAndFinalise,
  setError,
}: UseBatchReattachParams): void {
  const dispatch = useDispatch<AppDispatch>();

  /**
   * Reattach to a batch that's still being tracked (the page was refreshed or
   * the tab closed while it ran) — sidecar-side for VLM, in the Next process's
   * batch store for ONNX. The attach stream replays every result accumulated
   * so far, then follows live progress using the same SSE vocabulary as a
   * fresh batch. Works for terminal batches too — their replayed results get
   * flushed and the batch cleared.
   */
  const reattachToBatch = useCallback(
    async (batch: ActiveBatch) => {
      if (!projectFolderName) return;

      const jobId = batch.batchId;
      const isVlmBatch = (batch.providerType ?? 'vlm') === 'vlm';
      const isVlmTagRun = isVlmBatch && vlmOutput === 'tags';

      dispatch(
        addJob({
          id: jobId,
          type: 'tagging',
          status: 'running',
          createdAt: Date.now(),
          startedAt: Date.now(),
          completedAt: null,
          error: null,
          projectFolderName,
          projectName: projectName || projectFolderName,
          // Both derived server-side in /batch/active — the original request
          // isn't recoverable after a refresh.
          modelName: batch.modelName ?? 'Auto-tagger',
          providerType: batch.providerType ?? 'vlm',
          vlmOutput: isVlmBatch ? vlmOutput : undefined,
          progress: { current: batch.current, total: batch.total },
          summary: null,
          lastResult: null,
        }),
      );
      const abortController = registry.registerJob(
        jobId,
        batch.providerType ?? 'vlm',
      );
      setError(null);

      // Deliberately no pre-emptive clear of the staged results: the replay
      // below re-stages every result the batch holds, and the staging store is
      // keyed by fileId, so a replayed result overwrites its own earlier copy.
      // Clearing up front would destroy the only surviving copy whenever the
      // attach itself never lands.

      // Position comes from the project's saved settings; the value chosen
      // at start time wasn't persisted anywhere else.
      const saved = await getAutoTaggerSettings(projectFolderName).catch(
        () => null,
      );
      const position: 'start' | 'end' =
        saved?.tagInsertMode === 'prepend' ? 'start' : 'end';

      try {
        const response = await fetch(
          `/api/auto-tagger/batch/attach?batchId=${encodeURIComponent(jobId)}`,
          { signal: abortController.signal },
        );
        if (!response.ok || !response.body) {
          throw new Error('Failed to reattach to the running batch');
        }

        // Ownership is only claimed once the attach is known good. Marking
        // before the fetch orphaned a still-running batch for the whole session
        // on any transient failure — the sweep skips adopted ids forever.
        markBatchAdopted(jobId);
        registry.clearAttachFailures(jobId);

        let finished = false;

        for await (const event of readTaggingSseEvents(response.body)) {
          if (event.type === 'queued') {
            dispatch(
              updateTaggingProgress({
                id: jobId,
                progress: {
                  current: event.current,
                  total: event.total || batch.total,
                  queued: { position: event.position },
                },
              }),
            );
          } else if (event.type === 'loading') {
            dispatch(
              updateTaggingProgress({
                id: jobId,
                progress: {
                  current: 0,
                  total: batch.total,
                  loading: {
                    message: event.message,
                    current: event.current,
                    total: event.total,
                  },
                },
              }),
            );
          } else if (event.type === 'progress' || event.type === 'loaded') {
            dispatch(
              updateTaggingProgress({
                id: jobId,
                progress: {
                  current: event.current,
                  total: event.total || batch.total,
                  currentFileId: event.fileId,
                },
              }),
            );
          } else if (event.type === 'result') {
            // Same conversion the live stream applies: a VLM tag run's results
            // arrive as `caption` and are parsed into the tag block.
            const asTagList =
              isVlmTagRun && event.caption != null && !event.tags;
            const tags = asTagList
              ? parseTagListOutput(event.caption!)
              : event.tags;
            const caption = asTagList ? undefined : event.caption;
            appendPendingTagResult(projectFolderName, {
              fileId: event.fileId,
              tags,
              caption,
              position,
            });
            dispatch(
              recordTaggingResult({
                id: jobId,
                fileId: event.fileId,
                fileName: event.fileName,
                tags,
                caption,
              }),
            );
          } else if (event.type === 'error' && event.fileId) {
            console.warn(`Error captioning ${event.fileId}:`, event.error);
            registry.recordImageError(jobId, {
              fileId: event.fileId,
              error: event.error,
            });
          } else if (event.type === 'error') {
            throw new Error(event.error);
          } else if (event.type === 'complete') {
            finished = true;
            await flushAndFinalise(projectFolderName, jobId, {
              status: 'completed',
            });
          } else if (event.type === 'cancelled') {
            finished = true;
            dispatch(cancelTagging(jobId));
            await flushAndFinalise(projectFolderName, jobId, {
              status: 'cancelled',
            });
          }
        }

        if (!finished) {
          // Stream ended without a terminal event — keep whatever landed.
          if (summarisePendingResults(projectFolderName).imagesProcessed > 0) {
            await flushAndFinalise(projectFolderName, jobId, {
              status: 'completed',
            });
          } else {
            throw new Error('Lost connection to the batch.');
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          flushAndFinalise(projectFolderName, jobId, { status: 'cancelled' });
        } else {
          const message =
            err instanceof Error ? err.message : 'Reattach failed';
          setError(message);
          // Flush, don't clear: attaching to an already-failed batch replays
          // every good result it holds before throwing, and those staged
          // results are the only copy left once the batch is cleared (which
          // finalising does, so it stops resurfacing on every refresh).
          await flushAndFinalise(projectFolderName, jobId, {
            status: 'failed',
            error: message,
          });
          if (!hasBatchBeenAdopted(jobId)) {
            // The attach never landed, so the batch stays unadopted and a later
            // sweep can retry it — counted so it can't retry forever.
            registry.countAttachFailure(jobId);
          }
        }
      } finally {
        registry.releaseJob(jobId);
      }
    },
    [
      dispatch,
      flushAndFinalise,
      projectFolderName,
      projectName,
      vlmOutput,
      registry,
      setError,
    ],
  );

  // Discover batches the sidecar is still tracking for this project and
  // reattach to the first eligible one. Runs when the project mounts with no
  // active local job. Nothing here can double-attach: `reattachToBatch`
  // registers its job synchronously (so `activeTaggingJobId` blocks further
  // passes), and the module-level adopted set covers the rest of the session.
  // One batch per pass is enough — the next pass, once this one ends, picks up
  // the next eligible batch.
  const sweepInFlightRef = useRef(false);
  useEffect(() => {
    if (!projectFolderName || activeTaggingJobId) return;
    // One discovery pass at a time.
    if (sweepInFlightRef.current) return;

    let disposed = false;
    sweepInFlightRef.current = true;
    (async () => {
      let eligible: ActiveBatch | undefined;
      try {
        const res = await fetch(
          `/api/auto-tagger/batch/active?project=${encodeURIComponent(projectFolderName)}`,
        );
        if (!res.ok || disposed) return;
        const body = (await res.json()) as { batches: ActiveBatch[] };
        eligible = (body.batches ?? []).find(
          (candidate) =>
            !hasBatchBeenAdopted(candidate.batchId) &&
            registry.getAttachFailures(candidate.batchId) < MAX_ATTACH_ATTEMPTS,
        );
      } catch {
        // Sidecar unreachable — nothing to reattach to.
      } finally {
        // Released before the attach, not after: `reattachToBatch` runs for the
        // whole life of the stream, and it registers its job synchronously, so
        // `activeTaggingJobId` is what keeps concurrent sweeps out from here on.
        // A disposed pass doesn't release — the cleanup already did, and the
        // flag now belongs to whichever pass replaced it.
        if (!disposed) sweepInFlightRef.current = false;
      }
      if (eligible && !disposed) await reattachToBatch(eligible);
    })();
    return () => {
      disposed = true;
      sweepInFlightRef.current = false;
    };
  }, [projectFolderName, activeTaggingJobId, reattachToBatch, registry]);
}
