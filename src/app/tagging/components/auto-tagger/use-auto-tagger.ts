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
  getPendingTagResults,
  summarisePendingResults,
} from '@/app/services/auto-tagger/pending-tag-results';
import { readTaggingSseEvents } from '@/app/services/auto-tagger/sse-stream';
import {
  hasBatchBeenAdopted,
  markBatchAdopted,
  registerTaggingController,
  removeTaggingController,
} from '@/app/services/auto-tagger/tagging-controllers';
import type { DropdownGroup, DropdownItem } from '@/app/shared/dropdown';
import type { AppDispatch, RootState } from '@/app/store';
import { flushPendingTagResults } from '@/app/store/assets/flush-pending-tags';
import {
  fetchAutoTaggerModels,
  selectHasReadyModel,
  selectModels,
  selectModelsError,
  selectReadyModels,
  selectSelectedModelId,
  setSelectedModel,
} from '@/app/store/auto-tagger';
import {
  addJob,
  cancelTagging,
  completeTagging,
  failTagging,
  openJobDetail,
  recordTaggingResult,
  selectActiveTaggingJob,
  updateJobStatus,
  updateTaggingProgress,
} from '@/app/store/jobs';
import { selectKeepTaggerModelInMemory } from '@/app/store/preferences';
import {
  selectCaptionMode,
  selectCaptionPrompt,
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

/**
 * How a batch ended, as far as this client is concerned. `failed` still flushes
 * whatever landed — the staged results are the only surviving copy once the
 * sidecar's copy dies with the error.
 */
type FinaliseOutcome =
  | { status: 'completed'; completionDelayMs?: number }
  | { status: 'cancelled' }
  | { status: 'failed'; error: string };

/**
 * How many times the reattach sweep will try a single batch before giving up on
 * it for the session. More than one so a dev-server recompile or transient 500
 * during the attach fetch doesn't orphan a batch that's still running; bounded
 * so a batch that can never be attached doesn't re-fail on every sweep.
 */
const MAX_ATTACH_ATTEMPTS = 3;

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
  const modelsError = useSelector(selectModelsError);
  const readyModels = useSelector(selectReadyModels);
  const hasReadyModel = useSelector(selectHasReadyModel);
  const selectedModelId = useSelector(selectSelectedModelId);
  const captionMode = useSelector(selectCaptionMode);
  const captionPrompt = useSelector(selectCaptionPrompt);
  const triggerPhrases = useSelector(selectTriggerPhrases);
  const keepModelInMemory = useSelector(selectKeepTaggerModelInMemory);
  const projectInfo = useSelector((state: RootState) =>
    selectProjectInfo(state),
  );

  // Only show models compatible with the project's current mode:
  // - caption mode → VLM models (natural-language captioners)
  // - tag mode → ONNX models (imageboard-style taggers)
  // - hybrid mode → both; the selected model's provider type decides whether a
  //   run fills the tag block (ONNX) or the caption (VLM). Results are routed
  //   independently downstream, so either is safe.
  // Mixing tags/caption in the non-hybrid modes creates a footgun where
  // captions land on invisible fields or tags overwrite captions on save, so we
  // gate at selection there.
  const modeFilteredReadyModels = useMemo(() => {
    if (captionMode === 'hybrid') {
      return readyModels;
    }
    const targetProviderType: 'onnx' | 'vlm' =
      captionMode === 'caption' ? 'vlm' : 'onnx';
    return readyModels.filter(
      (m) => getProviderTypeForModel(m.id) === targetProviderType,
    );
  }, [readyModels, captionMode]);

  // Active tagging job for this project (from the jobs slice)
  const activeTaggingJob = useSelector((state: RootState) =>
    selectActiveTaggingJob(state, projectInfo.projectFolderName ?? ''),
  );

  // Derived state from the job. A batch's progress is the activity panel's
  // detail modal to show — this modal is only ever the settings step now — so
  // all we need from it is whether one is already running for this project.
  const isTagging = activeTaggingJob !== null;

  // Local settings state (not part of the job)
  const [options, setOptions] = useState<TaggerOptions>({
    ...DEFAULT_TAGGER_OPTIONS,
  });
  const [vlmOptions, setVlmOptions] = useState<VlmOptions>({
    ...DEFAULT_VLM_OPTIONS,
  });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [unselectOnComplete, setUnselectOnComplete] = useState(true);

  // Seed each run's prompt from the project's canonical prompt on the
  // closed→open transition, falling back to the built-in default for projects
  // that have never authored one. One-way by design: edits in the settings
  // panel below belong to this run and never travel back to the project.
  // Re-syncing on every render (or via an effect keyed on `captionPrompt`)
  // would clobber those edits mid-run — this is the React-docs
  // "adjusting state on prop change" pattern used by the project modals.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setVlmOptions((prev) => ({
        ...prev,
        prompt: captionPrompt ?? DEFAULT_VLM_OPTIONS.prompt,
      }));
    }
  }

  // Derive the provider type of the currently-selected model
  const selectedProviderType = selectedModelId
    ? getProviderTypeForModel(selectedModelId)
    : undefined;

  // Start-up failures (bad model, sidecar down) shown against the settings
  // form. Once a batch is under way its errors belong to the job.
  const [error, setError] = useState<string | null>(null);
  // Per-image errors collected during a batch run, handed to that job's
  // summary when it finalises. Refs so the SSE loop can accumulate without
  // re-rendering, and keyed by job id because two batches can be streaming at
  // once: this hook survives navigation and the sidecar queues batches, so a
  // single slot would build one job's summary out of the other's errors.
  const imageErrorsRef = useRef<
    Map<string, { fileId: string; error: string }[]>
  >(new Map());

  // The provider that actually ran each job. The current *selection* isn't it:
  // a reattached batch ran before this session's selection existed, and the
  // user can change the selector while a batch streams. Same per-job keying as
  // the errors above, for the same reason.
  const jobProviderTypesRef = useRef<Map<string, 'vlm' | 'onnx'>>(new Map());

  // Each live job's abort signal. `abortTagging` drops the controller from the
  // controllers module as it aborts, so the signal is held here to stay
  // queryable — it's the only truthful per-job "was this cancelled locally?".
  const jobAbortSignalsRef = useRef<Map<string, AbortSignal>>(new Map());

  // Consecutive failures to attach to a batch, per batch id. Bounds the
  // sweep's retries so a batch that can never be attached stops re-failing.
  const attachFailuresRef = useRef<Map<string, number>>(new Map());

  const isJobAborted = useCallback(
    (jobId: string) => jobAbortSignalsRef.current.get(jobId)?.aborted === true,
    [],
  );

  // Load the model inventory on open. The thunk's `condition` drops the
  // dispatch when the models are already loaded or a fetch is in flight, and
  // its failure surfaces through `modelsError` rather than local state.
  useEffect(() => {
    if (isOpen) dispatch(fetchAutoTaggerModels());
  }, [isOpen, dispatch]);

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
              // `prompt` is deliberately absent — it comes from the project's
              // canonical prompt (seeded on open below), not from run settings.
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
  // In hybrid mode both kinds are offered, so they're split into "Tags" and
  // "Natural Language" groups to make the choice legible. The single-mode views
  // only ever list one kind, so headings there would be noise.
  const modelItems: (DropdownItem<string> | DropdownGroup<string>)[] =
    useMemo(() => {
      const toItem = (model: (typeof modeFilteredReadyModels)[number]) => ({
        value: model.id,
        label: model.name,
      });

      if (captionMode !== 'hybrid') {
        return modeFilteredReadyModels.map(toItem);
      }

      const tagItems = modeFilteredReadyModels
        .filter((m) => getProviderTypeForModel(m.id) === 'onnx')
        .map(toItem);
      const captionItems = modeFilteredReadyModels
        .filter((m) => getProviderTypeForModel(m.id) === 'vlm')
        .map(toItem);

      // With only one kind installed the headings add nothing.
      if (tagItems.length === 0) return captionItems;
      if (captionItems.length === 0) return tagItems;

      return [
        { groupLabel: 'Imageboard-style Tagging', items: tagItems },
        { groupLabel: 'Natural Language', items: captionItems },
      ];
    }, [modeFilteredReadyModels, captionMode]);

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
    // Dismiss and reset. The tagging job lives in Redux and its SSE stream is
    // owned by this (always-mounted) hook, so closing changes nothing about a
    // batch in flight — it keeps going and drops finished tags in when done.
    onClose();
    setError(null);
    setSettingsLoaded(false);
  }, [onClose]);

  // Opening the tagger while this project already has a batch running goes
  // straight to that batch's detail view instead. There's only one batch per
  // project (a second would race the first for the same .txt files), so the
  // settings form has nothing to offer until this one is done — and the run is
  // almost certainly what the user came looking for anyway.
  useEffect(() => {
    if (!isOpen || !activeTaggingJob) return;
    dispatch(openJobDetail({ id: activeTaggingJob.id, type: 'tagging' }));
    onClose();
  }, [isOpen, activeTaggingJob, dispatch, onClose]);

  /**
   * Flush pending results from localStorage → Redux, deselect tagged assets,
   * drop the batch's stored copy, and record the job's terminal state. This is
   * the single mechanism for applying tags, whether tagging just completed or
   * the user returned to a project with pending results — and it runs for a
   * *failed* batch too, since whatever it managed to produce is worth keeping
   * and is the only copy left.
   */
  const flushAndFinalise = useCallback(
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
      const imageErrors = imageErrorsRef.current.get(jobId) ?? [];
      const baseSummary = summarisePendingResults(projectFolderName);
      const summaryData = {
        ...baseSummary,
        errorCount: imageErrors.length,
        errors: [...imageErrors],
        providerType:
          jobProviderTypesRef.current.get(jobId) ?? selectedProviderType,
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
        if (isJobAborted(jobId)) return;
      }
      dispatch(completeTagging({ id: jobId, summary: summaryData }));
    },
    [dispatch, unselectOnComplete, selectedProviderType, isJobAborted],
  );

  /**
   * Reattach to a batch that's still being tracked (the page was refreshed or
   * the tab closed while it ran) — sidecar-side for VLM, in the Next process's
   * batch store for ONNX. The attach stream replays every result accumulated
   * so far, then follows live progress using the same SSE vocabulary as a
   * fresh batch. Works for terminal batches too — their replayed results get
   * flushed and the batch cleared.
   */
  const reattachToBatch = useCallback(
    async (batch: {
      batchId: string;
      current: number;
      total: number;
      modelName?: string;
      providerType?: 'vlm' | 'onnx';
    }) => {
      const projectFolderName = projectInfo.projectFolderName;
      if (!projectFolderName) return;

      const jobId = batch.batchId;

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
          // Both derived server-side in /batch/active — the original request
          // isn't recoverable after a refresh.
          modelName: batch.modelName ?? 'Auto-tagger',
          providerType: batch.providerType ?? 'vlm',
          progress: { current: batch.current, total: batch.total },
          summary: null,
          lastResult: null,
        }),
      );
      const abortController = registerTaggingController(jobId);
      jobAbortSignalsRef.current.set(jobId, abortController.signal);
      imageErrorsRef.current.set(jobId, []);
      jobProviderTypesRef.current.set(jobId, batch.providerType ?? 'vlm');
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
        attachFailuresRef.current.delete(jobId);

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
            appendPendingTagResult(projectFolderName, {
              fileId: event.fileId,
              tags: event.tags,
              caption: event.caption,
              position,
            });
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
            console.warn(`Error captioning ${event.fileId}:`, event.error);
            imageErrorsRef.current.get(jobId)?.push({
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
            attachFailuresRef.current.set(
              jobId,
              (attachFailuresRef.current.get(jobId) ?? 0) + 1,
            );
          }
        }
      } finally {
        removeTaggingController(jobId);
        jobAbortSignalsRef.current.delete(jobId);
        imageErrorsRef.current.delete(jobId);
        jobProviderTypesRef.current.delete(jobId);
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
  // reattach to the first eligible one. Runs when the project mounts with no
  // active local job. Nothing here can double-attach: `reattachToBatch`
  // registers its job synchronously (so `activeTaggingJobId` blocks further
  // passes), and the module-level adopted set covers the rest of the session.
  // One batch per pass is enough — the next pass, once this one ends, picks up
  // the next eligible batch.
  const activeTaggingJobId = activeTaggingJob?.id ?? null;
  const sweepInFlightRef = useRef(false);
  useEffect(() => {
    const projectFolderName = projectInfo.projectFolderName;
    if (!projectFolderName || activeTaggingJobId) return;
    // One discovery pass at a time.
    if (sweepInFlightRef.current) return;

    let disposed = false;
    sweepInFlightRef.current = true;
    (async () => {
      let eligible:
        | {
            batchId: string;
            current: number;
            total: number;
            modelName?: string;
            providerType?: 'vlm' | 'onnx';
          }
        | undefined;
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
            modelName?: string;
            providerType?: 'vlm' | 'onnx';
          }[];
        };
        eligible = (body.batches ?? []).find(
          (candidate) =>
            !hasBatchBeenAdopted(candidate.batchId) &&
            (attachFailuresRef.current.get(candidate.batchId) ?? 0) <
              MAX_ATTACH_ATTEMPTS,
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

    const abortController = registerTaggingController(jobId);
    jobAbortSignalsRef.current.set(jobId, abortController.signal);

    setError(null);
    imageErrorsRef.current.set(jobId, []);
    if (selectedProviderType) {
      jobProviderTypesRef.current.set(jobId, selectedProviderType);
    }

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
          imageErrorsRef.current.get(jobId)?.push({
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
      removeTaggingController(jobId);
      jobAbortSignalsRef.current.delete(jobId);
      imageErrorsRef.current.delete(jobId);
      jobProviderTypesRef.current.delete(jobId);

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
    onClose,
  ]);

  return {
    // State
    options,
    vlmOptions,
    unselectOnComplete,
    isTagging,
    // Start-up failures raised here, or the shared models fetch giving up
    // after its retries — both belong against the settings form.
    error: error ?? modelsError,
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
    // What this run's prompt was seeded with, so the panel's Reset restores
    // the project's prompt rather than the built-in default.
    seededPrompt: captionPrompt ?? DEFAULT_VLM_OPTIONS.prompt,
    // Actions
    handleModelChange,
    handleOptionChange,
    handleVlmOptionChange,
    handleVideoOptionChange,
    setUnselectOnComplete,
    handleClose,
    handleStartTagging,
  };
}
