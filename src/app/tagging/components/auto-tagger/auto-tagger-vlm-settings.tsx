import { OctagonAlertIcon, RotateCcwIcon } from 'lucide-react';

import type {
  TriggerPhraseInsertMode,
  VlmOptions,
  VlmVideoQuality,
} from '@/app/services/auto-tagger';
import { Button } from '@/app/shared/button';
import { Checkbox } from '@/app/shared/checkbox';
import { Dropdown, DropdownGroup, DropdownItem } from '@/app/shared/dropdown';
import { FormTitle } from '@/app/shared/form-title/form-title';
import { NumberInput } from '@/app/shared/number-input/number-input';
import { RadioGroup } from '@/app/shared/radio-group';

const VIDEO_QUALITY_OPTIONS: { value: VlmVideoQuality; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'standard', label: 'Standard' },
  { value: 'high', label: 'High' },
];

type AutoTaggerVlmSettingsProps = {
  vlmOptions: VlmOptions;
  unselectOnComplete: boolean;
  selectedModelId: string | null;
  modelItems: (DropdownItem<string> | DropdownGroup<string>)[];
  triggerPhraseInsertModeOptions: {
    value: TriggerPhraseInsertMode;
    label: string;
  }[];
  selectedAssetsCount: number;
  /** Number of mp4/video assets in the selection — drives video controls visibility. */
  selectedVideoCount: number;
  /** Whether the chosen model can natively process video frames (not just stills). */
  selectedModelSupportsVideo: boolean;
  error: string | null;
  triggerPhrases: string[];
  /**
   * The prompt this run started from — the project's canonical prompt, or the
   * built-in default when the project hasn't authored one. Reset restores it.
   */
  seededPrompt: string;
  onModelChange: (modelId: string) => void;
  onVlmOptionChange: <K extends keyof VlmOptions>(
    key: K,
    value: VlmOptions[K],
  ) => void;
  onVideoOptionChange: <K extends keyof VlmOptions['video']>(
    key: K,
    value: VlmOptions['video'][K],
  ) => void;
  onUnselectOnCompleteChange: () => void;
  onClose: () => void;
  onStartTagging: () => void;
};

export function AutoTaggerVlmSettings({
  vlmOptions,
  unselectOnComplete,
  selectedModelId,
  modelItems,
  triggerPhraseInsertModeOptions,
  selectedAssetsCount,
  selectedVideoCount,
  selectedModelSupportsVideo,
  error,
  triggerPhrases,
  seededPrompt,
  onModelChange,
  onVlmOptionChange,
  onVideoOptionChange,
  onUnselectOnCompleteChange,
  onClose,
  onStartTagging,
}: AutoTaggerVlmSettingsProps) {
  const hasTriggerPhrases = triggerPhrases.length > 0;
  // Show the video controls when both conditions hold: the user has at
  // least one video in scope AND the chosen model can actually use them.
  // Showing only on (a) would suggest video sampling matters when it'll
  // be discarded for poster-frame substitution; showing only on (b) would
  // surface controls a user who's only tagging stills will never use.
  const showVideoControls =
    selectedVideoCount > 0 && selectedModelSupportsVideo;
  // Surface a small note when there are videos but the model can't handle
  // them, so the user understands why the controls are hidden and what
  // will happen to those videos instead.
  const showPosterFallbackNote =
    selectedVideoCount > 0 && !selectedModelSupportsVideo;
  return (
    <>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Generate natural-language captions for {selectedAssetsCount} selected{' '}
        {selectedAssetsCount !== 1 ? 'images' : 'image'}.
      </p>

      {error && (
        <div className="flex rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200">
          <OctagonAlertIcon className="mr-2 h-5 w-5 shrink-0" /> {error}
        </div>
      )}

      {/* Model selection */}
      <div className="flex flex-col gap-2">
        <FormTitle as="span" size="sm">
          Model
        </FormTitle>
        <Dropdown
          items={modelItems}
          selectedValue={selectedModelId || ''}
          onChange={onModelChange}
        />
      </div>

      {/* Prompt */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <FormTitle as="span" size="sm">
            Prompt
          </FormTitle>
          {vlmOptions.prompt !== seededPrompt && (
            <Button
              onClick={() => onVlmOptionChange('prompt', seededPrompt)}
              color="slate"
              variant="ghost"
              size="xs"
              width="sm"
            >
              <RotateCcwIcon />
              Reset
            </Button>
          )}
        </div>
        <textarea
          value={vlmOptions.prompt}
          onChange={(e) => onVlmOptionChange('prompt', e.target.value)}
          rows={6}
          className="resize-y rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-(--foreground) placeholder:text-slate-400 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
          placeholder="Describe this image in detail for AI training purposes."
        />
        <p className="text-sm text-slate-500">
          Starts from the project&apos;s caption prompt. Edits here apply to
          this run only — to change the project&apos;s prompt for good, use Edit
          Caption Prompt in the project menu.
        </p>
      </div>

      {/* Generation params */}
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <FormTitle as="span" size="sm">
            Max Tokens
          </FormTitle>
          <NumberInput
            spinner
            kind="int"
            min={32}
            max={4096}
            step={32}
            value={vlmOptions.maxTokens}
            onChange={(val) => onVlmOptionChange('maxTokens', val)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <FormTitle as="span" size="sm">
            Temperature: {vlmOptions.temperature.toFixed(2)}
          </FormTitle>
          <input
            type="range"
            min="0"
            max="1.5"
            step="0.05"
            value={vlmOptions.temperature}
            onChange={(e) =>
              onVlmOptionChange('temperature', parseFloat(e.target.value))
            }
            className="w-full"
          />
        </div>
      </div>

      {/* Video sampling controls — only shown when the user has at least
          one video in scope AND the chosen model can natively process
          video frames. Image-only models silently fall back to a poster
          frame upstream of this panel. */}
      {showVideoControls && (
        <div className="flex flex-col gap-2 rounded-md border border-slate-200 p-3 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <FormTitle as="span" size="sm">
              Video sampling ({selectedVideoCount}{' '}
              {selectedVideoCount === 1 ? 'video' : 'videos'})
            </FormTitle>
          </div>
          <p className="text-sm text-slate-500">
            Sampled frames are spread evenly across each video&apos;s full
            duration. Higher budget and quality use more VRAM.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1">
              <FormTitle as="span">Frame budget</FormTitle>
              <NumberInput
                spinner
                kind="int"
                min={4}
                max={128}
                step={4}
                value={vlmOptions.video.frameBudget}
                onChange={(val) => onVideoOptionChange('frameBudget', val)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <FormTitle as="span">Max FPS</FormTitle>
              <NumberInput
                min={0.1}
                max={8}
                value={vlmOptions.video.maxFps}
                onChange={(val) => onVideoOptionChange('maxFps', val)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <FormTitle as="span">Quality</FormTitle>
              <Dropdown
                items={VIDEO_QUALITY_OPTIONS}
                selectedValue={vlmOptions.video.quality}
                onChange={(quality) => onVideoOptionChange('quality', quality)}
              />
            </div>
          </div>
        </div>
      )}

      {showPosterFallbackNote && (
        <p className="text-sm text-slate-500">
          {selectedVideoCount === 1
            ? 'The selected video will'
            : `The ${selectedVideoCount} selected videos will`}{' '}
          be captioned from a single poster frame — the chosen model can&apos;t
          read video natively. Pick a video-capable model (e.g. Qwen3-VL GPU)
          for true frame-by-frame captioning.
        </p>
      )}

      {/* Trigger phrase injection — only offered when the project actually
          defines trigger phrases, otherwise the toggle does nothing. */}
      {hasTriggerPhrases && (
        <div className="flex flex-col gap-1">
          <Checkbox
            isSelected={vlmOptions.injectTriggerPhrases}
            onChange={() =>
              onVlmOptionChange(
                'injectTriggerPhrases',
                !vlmOptions.injectTriggerPhrases,
              )
            }
            label={`Require project trigger phrases (${triggerPhrases.length})`}
          />
          <p className="ml-7 text-sm text-slate-500">
            Appends an instruction telling the model to reproduce each trigger
            phrase verbatim in the caption. Useful for LoRA training where every
            caption needs the activation token.
          </p>
          {vlmOptions.injectTriggerPhrases && (
            <div className="mt-2 ml-7 flex flex-col gap-2">
              <FormTitle as="span" size="sm">
                Phrase position
              </FormTitle>
              <RadioGroup
                name="triggerPhraseInsertMode"
                options={triggerPhraseInsertModeOptions}
                value={vlmOptions.triggerPhraseInsertMode}
                onChange={(mode) =>
                  onVlmOptionChange('triggerPhraseInsertMode', mode)
                }
              />
            </div>
          )}
        </div>
      )}

      {/* Post-captioning options */}
      <div className="mt-2">
        <Checkbox
          isSelected={unselectOnComplete}
          onChange={onUnselectOnCompleteChange}
          label="Deselect captioned assets once complete"
        />
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <Button onClick={onClose} color="slate" size="md">
          Cancel
        </Button>
        <Button
          onClick={onStartTagging}
          color="indigo"
          size="md"
          disabled={!selectedModelId || selectedAssetsCount === 0}
        >
          Start Captioning
        </Button>
      </div>
    </>
  );
}
