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
