import { useCallback, useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';

import type { TaggerOptions, VlmOptions } from '@/app/services/auto-tagger';
import {
  DEFAULT_TAGGER_OPTIONS,
  DEFAULT_VLM_OPTIONS,
} from '@/app/services/auto-tagger';
import type { AppDispatch } from '@/app/store';
import { setSelectedModel } from '@/app/store/auto-tagger';
import type { ModelInfo } from '@/app/store/auto-tagger/types';
import { getAutoTaggerSettings } from '@/app/utils/project-actions';

type UseAutoTaggerSettingsParams = {
  isOpen: boolean;
  projectFolderName: string | undefined;
  models: ModelInfo[];
  readyModels: ModelInfo[];
  captionPrompt: string | null;
};

/**
 * The run's settings: the tagger/VLM option objects the form edits, seeded from
 * the project's saved defaults on open. Local to a run — nothing here is
 * written back to the project until a batch completes.
 */
export function useAutoTaggerSettings({
  isOpen,
  projectFolderName,
  models,
  readyModels,
  captionPrompt,
}: UseAutoTaggerSettingsParams) {
  const dispatch = useDispatch<AppDispatch>();

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

  // Load saved settings when modal opens (after models are available)
  useEffect(() => {
    if (isOpen && projectFolderName && !settingsLoaded && models.length > 0) {
      getAutoTaggerSettings(projectFolderName).then((savedSettings) => {
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
            // canonical prompt (seeded on open above), not from run settings.
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
      });
    }
  }, [
    isOpen,
    projectFolderName,
    settingsLoaded,
    models,
    readyModels,
    dispatch,
  ]);

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

  return {
    options,
    vlmOptions,
    unselectOnComplete,
    setUnselectOnComplete,
    /** Closing the modal re-arms the load, so the next open re-reads defaults. */
    setSettingsLoaded,
    handleOptionChange,
    handleVlmOptionChange,
    handleVideoOptionChange,
  };
}
