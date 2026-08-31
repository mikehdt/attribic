import { useMemo } from 'react';

import { isSupportedVideoExtension } from '@/app/constants';
import { getProviderTypeForModel } from '@/app/services/auto-tagger';
import type { DropdownGroup, DropdownItem } from '@/app/shared/dropdown';
import type { ModelInfo } from '@/app/store/auto-tagger/types';
import type { CaptionMode } from '@/app/store/project/types';

type UseTaggerModelOptionsParams = {
  models: ModelInfo[];
  readyModels: ModelInfo[];
  captionMode: CaptionMode;
  selectedModelId: string | null;
  selectedAssets: { fileId: string; fileExtension: string }[];
};

/**
 * Everything the settings form needs to describe the model choice: which models
 * the project's mode allows, how they group in the dropdown, and what the
 * current pick can do with the current selection.
 */
export function useTaggerModelOptions({
  models,
  readyModels,
  captionMode,
  selectedModelId,
  selectedAssets,
}: UseTaggerModelOptionsParams) {
  // Only show models compatible with the project's current mode:
  // - caption mode → VLM models only (an ONNX tag result would land on an
  //   invisible field, so gate at selection)
  // - tag mode → both: ONNX taggers, plus VLMs run as imageboard-style
  //   taggers — their output is parsed into the tag block
  // - hybrid mode → both; the selected model's provider type decides whether a
  //   run fills the tag block (ONNX) or the caption (VLM). Results are routed
  //   independently downstream, so either is safe.
  const modeFilteredReadyModels = useMemo(() => {
    if (captionMode === 'caption') {
      return readyModels.filter(
        (m) => getProviderTypeForModel(m.id) === 'vlm',
      );
    }
    return readyModels;
  }, [readyModels, captionMode]);

  // Model dropdown items — mode-restricted so only compatible models appear.
  // Where both kinds are offered they're split into groups to make the choice
  // legible: in hybrid mode the group decides tags-vs-caption output, in tag
  // mode it distinguishes the purpose-built taggers from VLMs prompted to tag.
  // Caption mode only ever lists one kind, so headings there would be noise.
  const modelItems: (DropdownItem<string> | DropdownGroup<string>)[] =
    useMemo(() => {
      const toItem = (model: (typeof modeFilteredReadyModels)[number]) => ({
        value: model.id,
        label: model.name,
      });

      if (captionMode === 'caption') {
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

      return captionMode === 'hybrid'
        ? [
            { groupLabel: 'Imageboard-style Tagging', items: tagItems },
            { groupLabel: 'Natural Language', items: captionItems },
          ]
        : [
            { groupLabel: 'Dedicated Taggers', items: tagItems },
            { groupLabel: 'Vision-Language Models', items: captionItems },
          ];
    }, [modeFilteredReadyModels, captionMode]);

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

  return {
    modeFilteredReadyModels,
    modelItems,
    // Whether there's *any* ready model that fits the current project mode.
    // Drives the "No models installed" warning in the modal.
    hasModelForMode: modeFilteredReadyModels.length > 0,
    selectedVideoCount,
    selectedModelSupportsVideo,
  };
}
