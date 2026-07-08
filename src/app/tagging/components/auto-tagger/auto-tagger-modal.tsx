'use client';

import { Modal } from '@/app/shared/modal';

import { AutoTaggerProgress } from './auto-tagger-progress';
import { AutoTaggerSettings } from './auto-tagger-settings';
import { AutoTaggerSummary } from './auto-tagger-summary';
import { AutoTaggerVlmSettings } from './auto-tagger-vlm-settings';
import { useAutoTagger } from './use-auto-tagger';

type AutoTaggerModalProps = {
  isOpen: boolean;
  onClose: () => void;
  selectedAssets: { fileId: string; fileExtension: string }[];
};

export function AutoTaggerModal({
  isOpen,
  onClose,
  selectedAssets,
}: AutoTaggerModalProps) {
  const {
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
    hasReadyModel,
    hasModelForMode,
    modelItems,
    selectedModelId,
    selectedProviderType,
    insertModeOptions,
    triggerPhraseInsertModeOptions,
    triggerPhrases,
    selectedVideoCount,
    selectedModelSupportsVideo,
    handleModelChange,
    handleOptionChange,
    handleVlmOptionChange,
    handleVideoOptionChange,
    setUnselectOnComplete,
    handleClose,
    handleCancel,
    handleStartTagging,
  } = useAutoTagger({ isOpen, onClose, selectedAssets });

  // The project's caption mode determines which settings panel and title
  // we show. Selection gating already ensures `selectedProviderType`
  // matches, but we prefer deriving from the filtered model list so the
  // title is correct even during the brief moment between mode flips
  // and the auto-select effect firing.
  const isVlm = selectedProviderType === 'vlm';
  const title = isVlm ? 'Caption Images' : 'Auto-Tag Images';

  return (
    <Modal isOpen={isOpen} onClose={handleClose} className="max-w-xl">
      <div className="flex flex-col gap-4">
        <h2 className="w-full text-2xl font-semibold text-slate-700 dark:text-slate-200">
          {title}
        </h2>

        {!hasReadyModel ? (
          <div className="rounded-md border border-amber-600 bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            <p className="font-medium">No models installed</p>
            <p className="mt-1">
              Please set up an auto-tagger model first using the project menu
              option.
            </p>
          </div>
        ) : !hasModelForMode ? (
          <div className="rounded-md border border-amber-600 bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            <p className="font-medium">
              {title === 'Caption Images'
                ? 'No caption models installed'
                : 'No tag models installed'}
            </p>
            <p className="mt-1">
              {title === 'Caption Images'
                ? 'Install a VLM (vision-language) model in the Model Manager to caption images in this mode. Or switch the project to tag mode to use a booru-style tagger.'
                : 'Install an ONNX tagger (e.g. WD14) in the Model Manager to tag images in this mode. Or switch the project to caption mode to use a VLM.'}
            </p>
          </div>
        ) : isTagging ? (
          <AutoTaggerProgress
            progress={progress}
            jobStatus={jobStatus}
            providerType={selectedProviderType}
            onCancel={handleCancel}
          />
        ) : summary ? (
          <AutoTaggerSummary
            summary={summary}
            wasCancelled={wasCancelled}
            providerType={selectedProviderType}
            imageErrors={imageErrors}
            onClose={handleClose}
          />
        ) : isVlm ? (
          <AutoTaggerVlmSettings
            vlmOptions={vlmOptions}
            unselectOnComplete={unselectOnComplete}
            selectedModelId={selectedModelId}
            modelItems={modelItems}
            triggerPhraseInsertModeOptions={triggerPhraseInsertModeOptions}
            selectedAssetsCount={selectedAssets.length}
            selectedVideoCount={selectedVideoCount}
            selectedModelSupportsVideo={selectedModelSupportsVideo}
            error={error}
            triggerPhrases={triggerPhrases}
            onModelChange={handleModelChange}
            onVlmOptionChange={handleVlmOptionChange}
            onVideoOptionChange={handleVideoOptionChange}
            onUnselectOnCompleteChange={() =>
              setUnselectOnComplete((prev) => !prev)
            }
            onClose={handleClose}
            onStartTagging={handleStartTagging}
          />
        ) : (
          <AutoTaggerSettings
            options={options}
            unselectOnComplete={unselectOnComplete}
            selectedModelId={selectedModelId}
            modelItems={modelItems}
            insertModeOptions={insertModeOptions}
            selectedAssetsCount={selectedAssets.length}
            error={error}
            onModelChange={handleModelChange}
            onOptionChange={handleOptionChange}
            onUnselectOnCompleteChange={() =>
              setUnselectOnComplete((prev) => !prev)
            }
            onClose={handleClose}
            onStartTagging={handleStartTagging}
          />
        )}
      </div>
    </Modal>
  );
}
