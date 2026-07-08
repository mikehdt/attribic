import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { isSupportedVideoExtension } from '@/app/constants';
import type {
  AutoTaggerSettings,
  TaggerOptions,
  TagInsertMode,
  TriggerPhraseInsertMode,
  VlmOptions,
} from '@/app/services/auto-tagger';
import {
  DEFAULT_TAGGER_OPTIONS,
  DEFAULT_VLM_OPTIONS,
  getProviderTypeForModel,
} from '@/app/services/auto-tagger';
import {
  appendPendingTagResult,
  clearPendingTagResults,
  summarisePendingResults,
} from '@/app/services/auto-tagger/pending-tag-results';
import {
  cancelTaggingJob,
  registerTaggingController,
  removeTaggingController,
} from '@/app/services/auto-tagger/tagging-controllers';
import type { DropdownItem } from '@/app/shared/dropdown';
import type { AppDispatch, RootState } from '@/app/store';
import { flushPendingTagResults } from '@/app/store/assets/flush-pending-tags';
import {
  selectHasReadyModel,
  selectModels,
  selectReadyModels,
  selectSelectedModelId,
  setModelsAndProviders,
  setSelectedModel,
} from '@/app/store/auto-tagger';
import {
  addJob,
  cancelTagging,
  completeTagging,
  failTagging,
  selectActiveTaggingJob,
  updateJobStatus,
  updateTaggingProgress,
} from '@/app/store/jobs';
import { selectKeepTaggerModelInMemory } from '@/app/store/preferences';
import {
  selectCaptionMode,
  selectProjectInfo,
  selectTriggerPhrases,
} from '@/app/store/project';
import { setAssetsSelectionState } from '@/app/store/selection';
import {
  getAutoTaggerSettings,
  saveAutoTaggerSettings,
} from '@/app/utils/project-actions';

type UseAutoTaggerParams = {
  isOpen: boolean;
  onClose: () => void;
  selectedAssets: { fileId: string; fileExtension: string }[];
};

// Batches this browser session has already reattached to. Module-level
// (not a ref) because the hook is instantiated by more than one component
// (tag menu + caption menu both mount the modal) — two instances racing the
// same batch would double-append results. Also covers cancelled batches the
// sidecar hasn't cleared yet, so they don't get re-adopted and re-flushed.
const reattachedBatchIds = new Set<string>();

const INSERT_MODE_OPTIONS: { value: TagInsertMode; label: string }[] = [
  { value: 'prepend', label: 'Prepend to start' },
  { value: 'append', label: 'Append to end' },
];

// Trigger phrase positioning has an extra 'integrate' option that asks the
// model to weave phrases into the prose where they fit. Ordered spatially
// (start → middle → end) so the radio reads as a position picker.
const TRIGGER_PHRASE_INSERT_MODE_OPTIONS: {
  value: TriggerPhraseInsertMode;
  label: string;
}[] = [
  { value: 'prepend', label: 'Prepend to start' },
  { value: 'integrate', label: 'Attempt to integrate' },
  { value: 'append', label: 'Append to end' },
];

export function useAutoTagger({
  isOpen,
  onClose,
  selectedAssets,
}: UseAutoTaggerParams) {
  const dispatch = useDispatch<AppDispatch>();

  // Redux state
  const models = useSelector(selectModels);
  const readyModels = useSelector(selectReadyModels);
  const hasReadyModel = useSelector(selectHasReadyModel);
  const selectedModelId = useSelector(selectSelectedModelId);
  const captionMode = useSelector(selectCaptionMode);
  const triggerPhrases = useSelector(selectTriggerPhrases);
  const keepModelInMemory = useSelector(selectKeepTaggerModelInMemory);
  const projectInfo = useSelector((state: RootState) =>
    selectProjectInfo(state),
  );

  // Only show models compatible with the project's current mode:
  // - caption mode → VLM models (natural-language captioners)
  // - tag mode → ONNX models (booru-style taggers)
  // Mixing the two creates a footgun where captions land on invisible
  // fields or tags overwrite captions on save, so we gate at selection.
  const modeFilteredReadyModels = useMemo(() => {
    const targetProviderType: 'onnx' | 'vlm' =
      captionMode === 'caption' ? 'vlm' : 'onnx';
    return readyModels.filter(
      (m) => getProviderTypeForModel(m.id) === targetProviderType,
    );
  }, [readyModels, captionMode]);

  // Active tagging job for this project (from the jobs slice)
  const activeTaggingJob = useSelector(
    selectActiveTaggingJob(projectInfo.projectFolderName ?? ''),
  );

  // Derived state from the job
  const isTagging = activeTaggingJob !== null;
  const progress = activeTaggingJob?.progress ?? null;
  const jobStatus = activeTaggingJob?.status ?? null;

  // Local settings state (not part of the job)
  const [options, setOptions] = useState<TaggerOptions>({
    ...DEFAULT_TAGGER_OPTIONS,
  });
  const [vlmOptions, setVlmOptions] = useState<VlmOptions>({
    ...DEFAULT_VLM_OPTIONS,
  });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [unselectOnComplete, setUnselectOnComplete] = useState(true);

  // Derive the provider type of the currently-selected model
  const selectedProviderType = selectedModelId
    ? getProviderTypeForModel(selectedModelId)
    : undefined;

  // Summary and error are set locally after the job completes,
  // since they drive the modal's summary view
  const [summary, setSummary] = useState<{
    imagesProcessed: number;
    imagesWithNewTags: number;
    totalTagsFound: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Per-image errors collected during the batch run, shown in the summary
  const [imageErrors, setImageErrors] = useState<
    { fileId: string; error: string }[]
  >([]);
  // Use a ref so we can accumulate errors inside the SSE loop without re-rendering
  const imageErrorsRef = useRef<{ fileId: string; error: string }[]>([]);
  const [wasCancelled, setWasCancelled] = useState(false);

  // Track the current job ID so we can cancel it
  const currentJobIdRef = useRef<string | null>(null);

  // Fetch models callback
  const fetchModels = useCallback(async () => {
    try {
      const response = await fetch('/api/auto-tagger/models');
      if (!response.ok) throw new Error('Failed to fetch models');
      const data = await response.json();
      dispatch(setModelsAndProviders(data));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load models');
    }
  }, [dispatch]);

  // Fetch models if not already loaded
  useEffect(() => {
    if (isOpen && models.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional data fetch on modal open; setState runs after the fetch resolves
      fetchModels();
    }
  }, [isOpen, models.length, fetchModels]);

  // Load saved settings when modal opens (after models are available)
  useEffect(() => {
    if (
      isOpen &&
      projectInfo.projectFolderName &&
      !settingsLoaded &&
      models.length > 0
    ) {
      getAutoTaggerSettings(projectInfo.projectFolderName).then(
        (savedSettings) => {
          if (savedSettings) {
            setOptions((prev) => ({
              ...prev,
              generalThreshold:
                savedSettings.generalThreshold ?? prev.generalThreshold,
              characterThreshold:
                savedSettings.characterThreshold ?? prev.characterThreshold,
              removeUnderscore:
                savedSettings.removeUnderscore ?? prev.removeUnderscore,
              includeCharacterTags:
                savedSettings.includeCharacterTags ?? prev.includeCharacterTags,
              includeRatingTags:
                savedSettings.includeRatingTags ?? prev.includeRatingTags,
              excludeTags: savedSettings.excludeTags ?? prev.excludeTags,
              tagInsertMode:
                savedSettings.tagInsertMode === 'prepend' ||
                savedSettings.tagInsertMode === 'append'
                  ? savedSettings.tagInsertMode
                  : prev.tagInsertMode,
            }));

            setVlmOptions((prev) => ({
              ...prev,
              prompt: savedSettings.prompt ?? prev.prompt,
              maxTokens: savedSettings.maxTokens ?? prev.maxTokens,
              temperature: savedSettings.temperature ?? prev.temperature,
              injectTriggerPhrases:
                savedSettings.injectTriggerPhrases ?? prev.injectTriggerPhrases,
              triggerPhraseInsertMode:
                savedSettings.triggerPhraseInsertMode === 'prepend' ||
                savedSettings.triggerPhraseInsertMode === 'integrate' ||
                savedSettings.triggerPhraseInsertMode === 'append'
                  ? savedSettings.triggerPhraseInsertMode
                  : prev.triggerPhraseInsertMode,
              video: savedSettings.video
                ? {
                    frameBudget:
                      savedSettings.video.frameBudget ?? prev.video.frameBudget,
                    maxFps: savedSettings.video.maxFps ?? prev.video.maxFps,
                    quality:
                      savedSettings.video.quality === 'low' ||
                      savedSettings.video.quality === 'standard' ||
                      savedSettings.video.quality === 'high'
                        ? savedSettings.video.quality
                        : prev.video.quality,
                  }
                : prev.video,
            }));

            if (
              savedSettings.defaultModelId &&
              readyModels.some((m) => m.id === savedSettings.defaultModelId)
            ) {
              dispatch(setSelectedModel(savedSettings.defaultModelId));
            }
          }
          setSettingsLoaded(true);
        },
      );
    }
  }, [
    isOpen,
    projectInfo.projectFolderName,
    settingsLoaded,
    models,
    readyModels,
    dispatch,
  ]);

  // Model dropdown items — mode-restricted so only compatible models appear.
  const modelItems: DropdownItem<string>[] = useMemo(
    () =>
      modeFilteredReadyModels.map((model) => ({
        value: model.id,
        label: model.name,
      })),
    [modeFilteredReadyModels],
  );

  // Whether there's *any* ready model that fits the current project mode.
  // Drives the "No models installed" warning in the modal.
  const hasModelForMode = modeFilteredReadyModels.length > 0;

  // How many of the selected assets are videos. Used by the VLM panel to
  // decide whether to surface the video sampling controls.
  const selectedVideoCount = useMemo(
    () =>
      selectedAssets.filter((a) =>
        isSupportedVideoExtension(`.${a.fileExtension}`),
      ).length,
    [selectedAssets],
  );

  // Whether the currently-selected model can natively process video frames.
  // False for GGUF/llama-cpp models and for any VLM entry without the flag.
  const selectedModelSupportsVideo = useMemo(() => {
    if (!selectedModelId) return false;
    const model = models.find((m) => m.id === selectedModelId);
    return model?.supportsVideo === true;
  }, [models, selectedModelId]);

  // If the persisted default model doesn't match the current mode (e.g. user
  // was in tag mode and picked Qwen3-VL, then switched to caption mode), fall
  // back to the first compatible model so the dropdown isn't empty-selected.
  useEffect(() => {
    if (!isOpen || modeFilteredReadyModels.length === 0) return;
    const current = selectedModelId
      ? modeFilteredReadyModels.find((m) => m.id === selectedModelId)
      : undefined;
    if (!current) {
      dispatch(setSelectedModel(modeFilteredReadyModels[0].id));
    }
  }, [isOpen, modeFilteredReadyModels, selectedModelId, dispatch]);

  const handleModelChange = useCallback(
    (modelId: string) => {
      dispatch(setSelectedModel(modelId));
    },
    [dispatch],
  );

  const handleOptionChange = useCallback(
    <K extends keyof TaggerOptions>(key: K, value: TaggerOptions[K]) => {
      setOptions((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const handleVlmOptionChange = useCallback(
    <K extends keyof VlmOptions>(key: K, value: VlmOptions[K]) => {
      setVlmOptions((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const handleVideoOptionChange = useCallback(
    <K extends keyof VlmOptions['video']>(
      key: K,
      value: VlmOptions['video'][K],
    ) => {
      setVlmOptions((prev) => ({
        ...prev,
        video: { ...prev.video, [key]: value },
      }));
    },
    [],
  );

  const handleClose = useCallback(() => {
    // Always dismiss. The tagging job lives in Redux and its SSE stream is
    // owned by this (always-mounted) hook, so closing mid-run just hides the
    // modal — the batch keeps going and drops finished tags in on completion.
    // Only clear the completed-run UI state when nothing is in flight, so a
    // reopen while tagging returns to the live progress view.
    onClose();
    if (!isTagging) {
      setSummary(null);
      setError(null);
      setWasCancelled(false);
      setSettingsLoaded(false);
    }
  }, [isTagging, onClose]);

  const handleCancel = useCallback(() => {
    // Use the local ref if this instance started the job, otherwise
    // fall back to the active job from Redux (e.g. modal auto-opened on return)
    const jobId = currentJobIdRef.current ?? activeTaggingJob?.id;
    if (jobId) {
      // Aborts the local stream AND cancels the sidecar batch — batches
      // survive disconnects now, so aborting alone stops nothing.
      cancelTaggingJob(jobId);
      // Don't re-adopt this batch if the sidecar hasn't cleared it yet.
      reattachedBatchIds.add(jobId);
      dispatch(cancelTagging(jobId));
    }
  }, [activeTaggingJob?.id, dispatch]);

  /**
   * Flush pending results from localStorage → Redux, then deselect tagged assets.
   * This is the single mechanism for applying tags, whether tagging just
   * completed or the user returned to a project with pending results.
   */
  const flushAndFinalise = useCallback(
    async (
      projectFolderName: string,
      jobId: string,
      cancelled: boolean,
      // Optional pause between dispatching flush + summary state and the
      // final `completeTagging`. Lets the progress bar render at 100% for
      // a beat before the modal flips to the summary view; otherwise the
      // last image's "done" frame is invisible. Skipped on cancel.
      completionDelayMs = 0,
    ) => {
      // Compute summary from localStorage before flushing clears it.
      // Enrich with errorCount + providerType so the activity-panel card can
      // distinguish "partial success" from "fully successful" and choose
      // captioning vs tagging wording.
      const baseSummary = summarisePendingResults(projectFolderName);
      const summaryData = {
        ...baseSummary,
        errorCount: imageErrorsRef.current.length,
        providerType: selectedProviderType,
      };

      // Tell the sidecar to drop its stored copy of this batch — the results
      // are being flushed locally now, and /batch/active must not resurface
      // it for reattach (that would apply everything a second time). No-op
      // for ONNX jobs and when the sidecar is gone. On local cancels the
      // batch may still be mid-cancel (409); cancelTaggingJob retries later.
      fetch('/api/auto-tagger/batch/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: jobId }),
      }).catch(() => {
        /* best-effort */
      });
      setSummary(summaryData);
      // Publish the errors we've accumulated for the summary view
      setImageErrors([...imageErrorsRef.current]);

      // Flush: read from localStorage → dispatch addMultipleTags → clear
      dispatch(flushPendingTagResults(projectFolderName));

      // Deselect assets that received tags
      if (unselectOnComplete && summaryData.imagesWithNewTags > 0) {
        // Re-read isn't needed — we know which assets were tagged from the summary
        // But we need the fileIds. Read from localStorage before flush clears them...
        // Actually, flush already cleared them. For deselection, we can use the
        // selectedAssets that were passed to the hook.
        dispatch(
          setAssetsSelectionState({
            assetIds: selectedAssets.map((a) => a.fileId),
            selected: false,
          }),
        );
      }

      // Update the job in the queue. The delay (if any) lets the progress
      // bar settle on 100% before the modal flips to the summary view.
      if (cancelled) {
        // cancelTagging already dispatched by the abort handler
        return;
      }
      if (completionDelayMs > 0) {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => setTimeout(resolve, completionDelayMs));
        });
        // If the user cancelled during the settle window, don't overwrite
        // their cancellation with a completed state.
        if (currentJobIdRef.current !== jobId) return;
      }
      dispatch(completeTagging({ id: jobId, summary: summaryData }));
    },
    [dispatch, unselectOnComplete, selectedAssets, selectedProviderType],
  );

  /**
   * Reattach to a caption batch the sidecar is still tracking (the page was
   * refreshed or the tab closed while it ran). The attach stream replays
   * every result the sidecar accumulated, then follows live progress using
   * the same SSE vocabulary as a fresh batch. Works for terminal batches
   * too — their replayed results get flushed and the batch cleared.
   */
  const reattachToBatch = useCallback(
    async (batch: {
      batchId: string;
      current: number;
      total: number;
      modelPath?: string | null;
    }) => {
      const projectFolderName = projectInfo.projectFolderName;
      if (!projectFolderName) return;

      const jobId = batch.batchId;
      // Derive a display name from the model path — the original request
      // isn't recoverable after a refresh.
      const modelName =
        batch.modelPath?.split(/[\\/]/).filter(Boolean).pop() ??
        'VLM captioner';

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
          projectName: projectInfo.projectName || projectFolderName,
          modelName,
          progress: { current: batch.current, total: batch.total },
          summary: null,
        }),
      );
      currentJobIdRef.current = jobId;
      const abortController = registerTaggingController(jobId);
      imageErrorsRef.current = [];
      setImageErrors([]);
      setWasCancelled(false);
      setError(null);

      // The sidecar's stored results are authoritative and replayed in
      // full — anything still in localStorage from the interrupted session
      // would be applied twice.
      clearPendingTagResults(projectFolderName);

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

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finished = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            let event;
            try {
              event = JSON.parse(line.slice(6));
            } catch (parseErr) {
              console.warn('Failed to parse attach SSE event:', parseErr);
              continue;
            }

            if (event.type === 'queued') {
              dispatch(
                updateTaggingProgress({
                  id: jobId,
                  progress: {
                    current: event.current ?? 0,
                    total: event.total ?? batch.total,
                    queued: { position: event.position ?? 1 },
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
                      message: event.message ?? 'Loading model',
                      current: event.current ?? 0,
                      total: event.total ?? 0,
                    },
                  },
                }),
              );
            } else if (event.type === 'progress' || event.type === 'loaded') {
              dispatch(
                updateTaggingProgress({
                  id: jobId,
                  progress: {
                    current: event.current ?? 0,
                    total: event.total ?? batch.total,
                  },
                }),
              );
            } else if (event.type === 'result') {
              appendPendingTagResult(projectFolderName, {
                fileId: event.fileId,
                tags: event.tags,
                caption: event.caption,
                position,
              });
            } else if (event.type === 'error' && event.fileId) {
              console.warn(`Error captioning ${event.fileId}:`, event.error);
              imageErrorsRef.current.push({
                fileId: event.fileId,
                error: event.error,
              });
            } else if (event.type === 'error') {
              throw new Error(event.error);
            } else if (event.type === 'complete') {
              finished = true;
              await flushAndFinalise(projectFolderName, jobId, false);
            } else if (event.type === 'cancelled') {
              finished = true;
              setWasCancelled(true);
              dispatch(cancelTagging(jobId));
              await flushAndFinalise(projectFolderName, jobId, true);
            }
          }
        }

        if (!finished) {
          // Stream ended without a terminal event — keep whatever landed.
          if (summarisePendingResults(projectFolderName).imagesProcessed > 0) {
            await flushAndFinalise(projectFolderName, jobId, false);
          } else {
            throw new Error('Lost connection to the batch.');
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          setWasCancelled(true);
          flushAndFinalise(projectFolderName, jobId, true);
        } else {
          const message =
            err instanceof Error ? err.message : 'Reattach failed';
          setError(message);
          dispatch(failTagging({ id: jobId, error: message }));
          clearPendingTagResults(projectFolderName);
        }
      } finally {
        removeTaggingController(jobId);
        if (currentJobIdRef.current === jobId) {
          currentJobIdRef.current = null;
        }
      }
    },
    [
      dispatch,
      flushAndFinalise,
      projectInfo.projectFolderName,
      projectInfo.projectName,
    ],
  );

  // Discover batches the sidecar is still tracking for this project and
  // reattach to the first one. Runs when the project mounts with no active
  // local job; the module-level set stops a second hook instance or a
  // re-run from double-attaching the same batch.
  const activeTaggingJobId = activeTaggingJob?.id ?? null;
  useEffect(() => {
    const projectFolderName = projectInfo.projectFolderName;
    if (!projectFolderName || activeTaggingJobId) return;

    let disposed = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/auto-tagger/batch/active?project=${encodeURIComponent(projectFolderName)}`,
        );
        if (!res.ok || disposed) return;
        const body = (await res.json()) as {
          batches: {
            batchId: string;
            current: number;
            total: number;
            modelPath?: string | null;
          }[];
        };
        const batch = body.batches?.[0];
        if (!batch || disposed) return;
        if (reattachedBatchIds.has(batch.batchId)) return;
        reattachedBatchIds.add(batch.batchId);
        await reattachToBatch(batch);
      } catch {
        // Sidecar unreachable — nothing to reattach to.
      }
    })();
    return () => {
      disposed = true;
    };
  }, [projectInfo.projectFolderName, activeTaggingJobId, reattachToBatch]);

  const handleStartTagging = useCallback(async () => {
    if (
      !selectedModelId ||
      !projectInfo.projectPath ||
      !projectInfo.projectFolderName
    )
      return;

    const projectFolderName = projectInfo.projectFolderName;

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
        projectName: projectInfo.projectName || projectFolderName,
        modelName,
        progress: {
          current: 0,
          total: selectedAssets.length,
          currentFileId: selectedAssets[0]?.fileId,
        },
        summary: null,
      }),
    );

    currentJobIdRef.current = jobId;
    const abortController = registerTaggingController(jobId);

    setSummary(null);
    setError(null);
    setWasCancelled(false);
    setImageErrors([]);
    imageErrorsRef.current = [];

    try {
      const response = await fetch('/api/auto-tagger/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: selectedModelId,
          projectPath: projectInfo.projectPath,
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

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          // Parse inside its own guard so that the `throw` for a
          // batch-level error event below escapes to the outer catch —
          // sharing a try with JSON.parse swallowed it as a parse warning.
          let event;
          try {
            event = JSON.parse(line.slice(6));
          } catch (parseErr) {
            console.warn('Failed to parse SSE event:', line, parseErr);
            continue;
          }

          if (event.type === 'queued') {
            // Waiting in the sidecar's job queue behind other GPU work.
            promoteToRunning();
            dispatch(
              updateTaggingProgress({
                id: jobId,
                progress: {
                  current: event.current ?? 0,
                  total: event.total ?? selectedAssets.length,
                  queued: { position: event.position ?? 1 },
                },
              }),
            );
          } else if (event.type === 'loading') {
            promoteToRunning();
            lastLoadingMessage = event.message ?? 'Loading model';
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
                    current: event.current ?? 0,
                    total: event.total ?? 0,
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
                  current: event.current ?? 0,
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
            if (currentJobIdRef.current !== jobId) continue;
            dispatch(
              updateTaggingProgress({
                id: jobId,
                progress: {
                  current: event.current ?? 0,
                  total: event.total ?? selectedAssets.length,
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
          } else if (event.type === 'error' && event.fileId) {
            // Per-image error — collect for the summary
            console.warn(`Error tagging ${event.fileId}:`, event.error);
            imageErrorsRef.current.push({
              fileId: event.fileId,
              error: event.error,
            });
          } else if (event.type === 'error') {
            throw new Error(event.error);
          } else if (event.type === 'complete') {
            receivedComplete = true;
            // 350ms pause between the final progress event and the
            // summary view so the progress bar visibly hits 100%.
            // Awaited (not fire-and-forget) so the outer try/finally
            // doesn't clear `currentJobIdRef` before the delayed
            // `completeTagging` dispatch lands — that would trip the
            // cancel-check inside flushAndFinalise and silently swallow
            // the completion, leaving the modal stuck on the progress
            // view forever.
            await flushAndFinalise(projectFolderName, jobId, false, 350);

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
              prompt: vlmOptions.prompt,
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
            setWasCancelled(true);
            dispatch(cancelTagging(jobId));
            await flushAndFinalise(projectFolderName, jobId, true);
          }
        }
      }

      // Process any remaining data in buffer
      if (buffer.startsWith('data: ')) {
        try {
          const event = JSON.parse(buffer.slice(6));
          if (event.type === 'result') {
            appendPendingTagResult(projectFolderName, {
              fileId: event.fileId,
              tags: event.tags,
              caption: event.caption,
              position,
            });
          } else if (event.type === 'complete') {
            receivedComplete = true;
          }
        } catch (parseErr) {
          console.warn('Failed to parse final SSE event:', buffer, parseErr);
        }
      }

      if (!receivedComplete) {
        // Stream ended without a complete event — flush whatever we have
        if (summarisePendingResults(projectFolderName).imagesProcessed > 0) {
          flushAndFinalise(projectFolderName, jobId, false);
        } else {
          throw new Error(
            'No results received from tagger. Check server logs for errors.',
          );
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setWasCancelled(true);
        // Flush any partial results that made it to localStorage
        flushAndFinalise(projectFolderName, jobId, true);
      } else {
        const message = err instanceof Error ? err.message : 'Tagging failed';
        setError(message);
        dispatch(failTagging({ id: jobId, error: message }));
        clearPendingTagResults(projectFolderName);
      }
    } finally {
      removeTaggingController(jobId);
      currentJobIdRef.current = null;

      // Auto-release the model from GPU/CPU memory if the preference says to.
      // Best-effort fire-and-forget — an unload failure shouldn't surface as
      // a user-visible error, and the next batch reloads automatically.
      if (!keepModelInMemory) {
        fetch('/api/auto-tagger/unload', { method: 'POST' }).catch(() => {
          /* best-effort */
        });
      }
    }
  }, [
    selectedModelId,
    projectInfo.projectPath,
    projectInfo.projectFolderName,
    projectInfo.projectName,
    selectedAssets,
    readyModels,
    options,
    vlmOptions,
    triggerPhrases,
    flushAndFinalise,
    keepModelInMemory,
    dispatch,
  ]);

  return {
    // State
    options,
    vlmOptions,
    unselectOnComplete,
    isTagging,
    progress,
    jobStatus,
    summary,
    error,
    imageErrors,
    wasCancelled,
    // True when any model at all is installed — kept for the outer modal gate.
    hasReadyModel,
    // True when at least one *compatible* model exists for the current project
    // mode. Drives the "No models installed" warning inside the modal.
    hasModelForMode,
    modelItems,
    selectedModelId,
    selectedProviderType,
    insertModeOptions: INSERT_MODE_OPTIONS,
    triggerPhraseInsertModeOptions: TRIGGER_PHRASE_INSERT_MODE_OPTIONS,
    triggerPhrases,
    selectedVideoCount,
    selectedModelSupportsVideo,
    // Actions
    handleModelChange,
    handleOptionChange,
    handleVlmOptionChange,
    handleVideoOptionChange,
    setUnselectOnComplete,
    handleClose,
    handleCancel,
    handleStartTagging,
  };
}
