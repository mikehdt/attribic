import type { Dispatch, SetStateAction } from 'react';
import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import type {
  AutoTaggerSettings,
  ProviderType,
  TaggerOptions,
  VlmOptions,
} from '@/app/services/auto-tagger';
import {
  appendPendingTagResult,
  clearPendingTagResults,
  summarisePendingResults,
} from '@/app/services/auto-tagger/pending-tag-results';
import { readTaggingSseEvents } from '@/app/services/auto-tagger/sse-stream';
import type { AppDispatch } from '@/app/store';
import type { ModelInfo } from '@/app/store/auto-tagger/types';
import {
  addJob,
  cancelTagging,
  openJobDetail,
  recordTaggingResult,
  updateJobStatus,
  updateTaggingProgress,
} from '@/app/store/jobs';
import { selectKeepTaggerModelInMemory } from '@/app/store/preferences';
import { saveAutoTaggerSettings } from '@/app/utils/project-actions';

import type { FlushAndFinalise } from './use-flush-and-finalise';
import type { TaggingJobRegistry } from './use-tagging-job-registry';

type UseStartTaggingParams = {
  projectPath: string | undefined;
  projectFolderName: string | undefined;
  projectName: string | undefined;
  selectedModelId: string | null;
  selectedProviderType: ProviderType | undefined;
  selectedAssets: { fileId: string; fileExtension: string }[];
  readyModels: ModelInfo[];
  options: TaggerOptions;
  vlmOptions: VlmOptions;
  triggerPhrases: string[];
  registry: TaggingJobRegistry;
  flushAndFinalise: FlushAndFinalise;
  setError: Dispatch<SetStateAction<string | null>>;
  onClose: () => void;
};

/**
 * Launch a batch and consume its SSE stream to the end. The stream deliberately
 * outlives the modal (and navigation): the sidecar keeps running whether or not
 * anyone is listening, so detaching is not the same thing as finishing.
 */
export function useStartTagging({
  projectPath,
  projectFolderName,
  projectName,
  selectedModelId,
  selectedProviderType,
  selectedAssets,
  readyModels,
  options,
  vlmOptions,
  triggerPhrases,
  registry,
  flushAndFinalise,
  setError,
  onClose,
}: UseStartTaggingParams) {
  const dispatch = useDispatch<AppDispatch>();
  const keepModelInMemory = useSelector(selectKeepTaggerModelInMemory);

  return useCallback(async () => {
    if (!selectedModelId || !projectPath || !projectFolderName) return;

    // Clear any stale pending results for this project before starting
    clearPendingTagResults(projectFolderName);

    // Create a job in the queue
    const jobId = `tagging-${Date.now()}`;
    const modelName =
      readyModels.find((m) => m.id === selectedModelId)?.name ??
      selectedModelId;

    const position: 'start' | 'end' =
      options.tagInsertMode === 'prepend' ? 'start' : 'end';

    dispatch(
      addJob({
        id: jobId,
        type: 'tagging',
        status: 'preparing',
        createdAt: Date.now(),
        startedAt: Date.now(),
        completedAt: null,
        error: null,
        projectFolderName,
        projectName: projectName || projectFolderName,
        modelName,
        providerType: selectedProviderType,
        progress: {
          current: 0,
          total: selectedAssets.length,
          currentFileId: selectedAssets[0]?.fileId,
        },
        summary: null,
        lastResult: null,
      }),
    );

    // Hand straight over to the activity panel's detail view — it's the one
    // progress surface for a batch, and it covers everything from the queue
    // wait through to the final summary. This modal's job (choosing a model
    // and settings) is done.
    dispatch(openJobDetail({ id: jobId, type: 'tagging' }));
    onClose();

    const abortController = registry.registerJob(jobId, selectedProviderType);

    setError(null);

    // Whether the batch reached a terminal state on the sidecar (finished,
    // was cancelled, or genuinely errored) — as opposed to this client merely
    // detaching from a batch that keeps running server-side (refresh, tab
    // close, navigation). Only a true terminal state may release the model:
    // unloading on a detach pulls the weights out from under a still-running
    // batch, forcing the sidecar to reload them for the next image — which is
    // exactly what surfaces as "Loading model" when the next page reattaches.
    let batchTerminatedServerSide = false;

    try {
      const response = await fetch('/api/auto-tagger/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: selectedModelId,
          projectPath,
          // The job ID doubles as the sidecar batch ID so cancel and
          // reattach can address the batch with the ID we already track.
          batchId: jobId,
          projectFolderName,
          assets: selectedAssets,
          options,
          vlmOptions,
          triggerPhrases,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        // Try to surface the server-side error message (e.g. "Model is not installed")
        let message = `Failed to start tagging (${response.status})`;
        try {
          const body = await response.json();
          if (body?.error) message = body.error;
        } catch {
          // Non-JSON response — fall back to generic message
        }
        throw new Error(message);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      let receivedComplete = false;
      // Flip from `preparing` → `running` once the backend emits its first
      // signal of any kind. Until then the progress UI shows a "Starting..."
      // indeterminate state instead of "Tagging image 1 of N" with an empty
      // bar, which was misleading: nothing is actually being tagged yet, the
      // model is still spinning up. One-shot flag so we don't dispatch on
      // every event after the first.
      let promotedToRunning = false;
      const promoteToRunning = () => {
        if (promotedToRunning) return;
        // A cancel can land between stream events; promoting after it would
        // flip the cancelled job back to running (the jobs reducers guard
        // progress/result dispatches, but updateJobStatus is generic).
        if (abortController.signal.aborted) return;
        promotedToRunning = true;
        dispatch(updateJobStatus({ id: jobId, status: 'running' }));
      };

      // Track the most-recent loading event so a `loaded` transition can
      // re-emit it at 100% before pausing. Without this, the model-ready
      // tick from the sidecar gets clobbered by the immediate switch to
      // image-tagging and never paints.
      let lastLoadingMessage = 'Loading model';

      // Brief pause to let the previous progress state paint before moving
      // to the next phase. Same trick `completeAfterDelay` uses for the
      // project loader: RAF guarantees a render frame, then the timeout
      // gives the user time to perceive 100%. 350ms matches that helper.
      const settleFrame = () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => setTimeout(resolve, 350));
        });

      for await (const event of readTaggingSseEvents(response.body)) {
        if (event.type === 'queued') {
          // Waiting in the sidecar's job queue behind other GPU work.
          promoteToRunning();
          dispatch(
            updateTaggingProgress({
              id: jobId,
              progress: {
                current: event.current,
                total: event.total || selectedAssets.length,
                queued: { position: event.position },
              },
            }),
          );
        } else if (event.type === 'loading') {
          promoteToRunning();
          lastLoadingMessage = event.message;
          // Model-loading sub-state — show a spinner with the shard
          // progress while the sidecar reads weights into GPU/RAM.
          dispatch(
            updateTaggingProgress({
              id: jobId,
              progress: {
                current: 0,
                total: selectedAssets.length,
                loading: {
                  message: lastLoadingMessage,
                  current: event.current,
                  total: event.total,
                },
              },
            }),
          );
        } else if (event.type === 'loaded') {
          // Loading → tagging transition. Force the loading bar to
          // 100% (some sidecar backends end on a non-100% shard tick),
          // pause briefly so the user perceives "loaded", then drop
          // the loading sub-state to reveal the image counter.
          promoteToRunning();
          dispatch(
            updateTaggingProgress({
              id: jobId,
              progress: {
                current: event.current,
                total: selectedAssets.length,
                loading: {
                  message: lastLoadingMessage,
                  current: 1,
                  total: 1,
                },
              },
            }),
          );
          await settleFrame();
          // The user may have hit Cancel during the pause; bail out
          // of the transition rather than blowing away cancelled
          // state with a fresh progress dispatch.
          if (abortController.signal.aborted) continue;
          dispatch(
            updateTaggingProgress({
              id: jobId,
              progress: {
                current: event.current,
                total: event.total || selectedAssets.length,
                currentFileId: event.fileId,
              },
            }),
          );
        } else if (event.type === 'progress') {
          promoteToRunning();
          dispatch(
            updateTaggingProgress({
              id: jobId,
              progress: {
                current: event.current,
                total: event.total,
                currentFileId: event.fileId,
                // `loading` intentionally omitted — the first real
                // progress event clears the loading overlay.
              },
            }),
          );
        } else if (event.type === 'result') {
          // Persist to localStorage — the single source of truth.
          // Event may carry either tags (ONNX) or caption (VLM).
          appendPendingTagResult(projectFolderName, {
            fileId: event.fileId,
            tags: event.tags,
            caption: event.caption,
            position,
          });
          // Mirror the latest result into the job so the activity panel's
          // detail view can show it. Display-only, and deliberately not the
          // path results take to the assets slice — that stays the
          // end-of-batch flush out of localStorage.
          dispatch(
            recordTaggingResult({
              id: jobId,
              fileId: event.fileId,
              fileName: event.fileName,
              tags: event.tags,
              caption: event.caption,
            }),
          );
        } else if (event.type === 'error' && event.fileId) {
          // Per-image error — collect for this job's summary
          console.warn(`Error tagging ${event.fileId}:`, event.error);
          registry.recordImageError(jobId, {
            fileId: event.fileId,
            error: event.error,
          });
        } else if (event.type === 'error') {
          throw new Error(event.error);
        } else if (event.type === 'complete') {
          receivedComplete = true;
          batchTerminatedServerSide = true;
          // 350ms pause between the final progress event and the
          // summary view so the progress bar visibly hits 100%.
          // Awaited (not fire-and-forget) so the outer try/finally
          // doesn't drop this job's abort signal before the delayed
          // `completeTagging` lands — flushAndFinalise's cancel check
          // needs it, and the model unload in the finally must not run
          // ahead of the completion.
          await flushAndFinalise(projectFolderName, jobId, {
            status: 'completed',
            completionDelayMs: 350,
          });

          // Save settings as defaults for this project
          const settingsToSave: AutoTaggerSettings = {
            defaultModelId: selectedModelId,
            generalThreshold: options.generalThreshold,
            characterThreshold: options.characterThreshold,
            removeUnderscore: options.removeUnderscore,
            includeCharacterTags: options.includeCharacterTags,
            includeRatingTags: options.includeRatingTags,
            excludeTags: options.excludeTags,
            tagInsertMode: options.tagInsertMode,
            // `prompt` is deliberately not saved: the project's canonical
            // prompt is authored from the project menu, and a run's edits
            // apply to that run only.
            maxTokens: vlmOptions.maxTokens,
            temperature: vlmOptions.temperature,
            injectTriggerPhrases: vlmOptions.injectTriggerPhrases,
            triggerPhraseInsertMode: vlmOptions.triggerPhraseInsertMode,
            video: vlmOptions.video,
          };
          saveAutoTaggerSettings(projectFolderName, settingsToSave).catch(
            console.error,
          );
        } else if (event.type === 'cancelled') {
          // Batch cancelled on the sidecar side (queue removal or a
          // cancel from another tab) — treat like a local cancel:
          // keep whatever results already landed. The job status update
          // is dispatched here because no local abort handler ran.
          receivedComplete = true;
          batchTerminatedServerSide = true;
          dispatch(cancelTagging(jobId));
          await flushAndFinalise(projectFolderName, jobId, {
            status: 'cancelled',
          });
        }
      }

      if (!receivedComplete) {
        // Stream ended without a complete event — flush whatever we have
        if (summarisePendingResults(projectFolderName).imagesProcessed > 0) {
          flushAndFinalise(projectFolderName, jobId, { status: 'completed' });
        } else {
          throw new Error(
            'No results received from tagger. Check server logs for errors.',
          );
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // The client detached (cancel, tab close, refresh, navigation). The
        // sidecar batch keeps running and is reattached to later, so this is
        // NOT a terminal state — leave the model loaded.
        flushAndFinalise(projectFolderName, jobId, { status: 'cancelled' });
      } else {
        // A genuine batch-level error from the sidecar — the run is over, so
        // the model can be released.
        batchTerminatedServerSide = true;
        const message = err instanceof Error ? err.message : 'Tagging failed';
        setError(message);
        // Flush, don't clear: every result staged before the error is the only
        // surviving copy (the sidecar's died with it), and finalising also
        // clears the failed batch so it can't resurface on the next refresh.
        await flushAndFinalise(projectFolderName, jobId, {
          status: 'failed',
          error: message,
        });
      }
    } finally {
      registry.releaseJob(jobId);

      // Auto-release the model from GPU/CPU memory if the preference says to,
      // but ONLY once the batch has genuinely finished server-side. Detaching
      // (refresh/navigation) leaves the batch running on the sidecar, so
      // unloading here would evict the model mid-run and force a reload —
      // surfacing as a spurious "Loading model" the moment the page reattaches.
      // Best-effort fire-and-forget — an unload failure shouldn't surface as
      // a user-visible error, and the next batch reloads automatically.
      if (!keepModelInMemory && batchTerminatedServerSide) {
        fetch('/api/auto-tagger/unload', { method: 'POST' }).catch(() => {
          /* best-effort */
        });
      }
    }
  }, [
    selectedModelId,
    selectedProviderType,
    projectPath,
    projectFolderName,
    projectName,
    selectedAssets,
    readyModels,
    options,
    vlmOptions,
    triggerPhrases,
    flushAndFinalise,
    keepModelInMemory,
    dispatch,
    onClose,
    registry,
    setError,
  ]);
}
