import { useCallback, useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import type {
  TagInsertMode,
  TriggerPhraseInsertMode,
  VlmOutputTarget,
} from '@/app/services/auto-tagger';
import {
  DEFAULT_VLM_OPTIONS,
  DEFAULT_VLM_TAG_PROMPT,
  getProviderTypeForModel,
} from '@/app/services/auto-tagger';
import type { AppDispatch, RootState } from '@/app/store';
import {
  fetchAutoTaggerModels,
  selectHasReadyModel,
  selectModels,
  selectModelsError,
  selectReadyModels,
  selectSelectedModelId,
  setSelectedModel,
} from '@/app/store/auto-tagger';
import { openJobDetail, selectActiveTaggingJob } from '@/app/store/jobs';
import {
  selectCaptionMode,
  selectCaptionPrompt,
  selectProjectInfo,
  selectTriggerPhrases,
} from '@/app/store/project';

import { useAutoTaggerSettings } from './use-auto-tagger-settings';
import { useBatchReattach } from './use-batch-reattach';
import { useFlushAndFinalise } from './use-flush-and-finalise';
import { useStartTagging } from './use-start-tagging';
import { useTaggerModelOptions } from './use-tagger-model-options';
import { useTaggerScope } from './use-tagger-scope';
import { useTaggingJobRegistry } from './use-tagging-job-registry';

type UseAutoTaggerParams = {
  isOpen: boolean;
  onClose: () => void;
};

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

export function useAutoTagger({ isOpen, onClose }: UseAutoTaggerParams) {
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
  const projectInfo = useSelector((state: RootState) =>
    selectProjectInfo(state),
  );

  // Which assets the batch runs over — all by default, narrowed by the scope
  // checkboxes in the settings panels.
  const scope = useTaggerScope(isOpen);
  const scopedAssets = scope.scopedAssets;

  const {
    modeFilteredReadyModels,
    modelItems,
    hasModelForMode,
    selectedVideoCount,
    selectedModelSupportsVideo,
  } = useTaggerModelOptions({
    models,
    readyModels,
    captionMode,
    selectedModelId,
    selectedAssets: scopedAssets,
  });

  // Active tagging job for this project (from the jobs slice)
  const activeTaggingJob = useSelector((state: RootState) =>
    selectActiveTaggingJob(state, projectInfo.projectFolderName ?? ''),
  );

  // Derived state from the job. A batch's progress is the activity panel's
  // detail modal to show — this modal is only ever the settings step now — so
  // all we need from it is whether one is already running for this project.
  const isTagging = activeTaggingJob !== null;

  // Derive the provider type of the currently-selected model
  const selectedProviderType = selectedModelId
    ? getProviderTypeForModel(selectedModelId)
    : undefined;

  // What a VLM run produces here: tag-mode projects run VLMs as
  // imageboard-style taggers, every other mode as captioners.
  const vlmOutput: VlmOutputTarget =
    captionMode === 'tags' ? 'tags' : 'caption';

  // Start-up failures (bad model, sidecar down) shown against the settings
  // form. Once a batch is under way its errors belong to the job.
  const [error, setError] = useState<string | null>(null);

  // Load the model inventory on open. The thunk's `condition` drops the
  // dispatch when the models are already loaded or a fetch is in flight, and
  // its failure surfaces through `modelsError` rather than local state.
  useEffect(() => {
    if (isOpen) dispatch(fetchAutoTaggerModels());
  }, [isOpen, dispatch]);

  const {
    options,
    vlmOptions,
    unselectOnComplete,
    setUnselectOnComplete,
    setSettingsLoaded,
    handleOptionChange,
    handleVlmOptionChange,
    handleVideoOptionChange,
  } = useAutoTaggerSettings({
    isOpen,
    projectFolderName: projectInfo.projectFolderName,
    models,
    readyModels,
    captionMode,
    captionPrompt,
  });

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

  const handleClose = useCallback(() => {
    // Dismiss and reset. The tagging job lives in Redux and its SSE stream is
    // owned by this (always-mounted) hook, so closing changes nothing about a
    // batch in flight — it keeps going and drops finished tags in when done.
    onClose();
    setError(null);
    setSettingsLoaded(false);
  }, [onClose, setSettingsLoaded]);

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

  const registry = useTaggingJobRegistry();

  const flushAndFinalise = useFlushAndFinalise({
    registry,
    unselectOnComplete,
    selectedProviderType,
  });

  useBatchReattach({
    projectFolderName: projectInfo.projectFolderName,
    projectName: projectInfo.projectName,
    activeTaggingJobId: activeTaggingJob?.id ?? null,
    vlmOutput,
    registry,
    flushAndFinalise,
    setError,
  });

  const handleStartTagging = useStartTagging({
    projectPath: projectInfo.projectPath,
    projectFolderName: projectInfo.projectFolderName,
    projectName: projectInfo.projectName,
    selectedModelId,
    selectedProviderType,
    selectedAssets: scopedAssets,
    readyModels,
    options,
    vlmOptions,
    vlmOutput,
    triggerPhrases,
    registry,
    flushAndFinalise,
    setError,
    onClose,
  });

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
    vlmOutput,
    scope,
    insertModeOptions: INSERT_MODE_OPTIONS,
    triggerPhraseInsertModeOptions: TRIGGER_PHRASE_INSERT_MODE_OPTIONS,
    triggerPhrases,
    selectedVideoCount,
    selectedModelSupportsVideo,
    // What this run's prompt was seeded with, so the panel's Reset restores
    // the seed rather than the built-in caption default. Mirrors the seeding
    // in useAutoTaggerSettings: tag runs start from the built-in tag prompt.
    seededPrompt:
      vlmOutput === 'tags'
        ? DEFAULT_VLM_TAG_PROMPT
        : (captionPrompt ?? DEFAULT_VLM_OPTIONS.prompt),
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
