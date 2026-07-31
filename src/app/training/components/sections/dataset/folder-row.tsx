import {
  ChevronDownIcon,
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  FlipHorizontal2Icon,
  FlipVertical2Icon,
  FolderOpenIcon,
  HomeIcon,
  ScaleIcon,
  XIcon,
} from 'lucide-react';

import type { TrainingProvider } from '@/app/services/training/types';
import { Button } from '@/app/shared/button';
import { Checkbox } from '@/app/shared/checkbox';
import { FormTitle } from '@/app/shared/form-title/form-title';
import { NumberInput } from '@/app/shared/number-input/number-input';
import type { TrainingViewMode } from '@/app/store/preferences';

import type { FolderAugmentation } from '../../training-config-form/use-training-config-form';

type FolderRowProps = {
  datasetIndex: number | null; // null = extra folder
  // Drives which augmentation controls are shown — e.g. Kohya/sd-scripts has
  // no vertical-flip augmentation, so "Flip vertically" is hidden for it.
  selectedProvider: TrainingProvider;
  /** Simple mode drops the finer-grained knobs to read-only text. */
  viewMode: TrainingViewMode;
  folderName: string;
  detectedRepeats: number;
  effectiveRepeats: number;
  imageCount?: number;
  augmentation: FolderAugmentation;
  showRepeats: boolean;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onSetRepeats: (
    datasetIndex: number | null,
    folderName: string,
    repeats: number | null,
  ) => void;
  onUpdateAugment: (
    datasetIndex: number | null,
    folderName: string,
    updates: Partial<FolderAugmentation>,
  ) => void;
  /** Extra folders get a remove button; dataset folders don't (remove the parent project instead). */
  onRemove?: () => void;
  /** Display label override (e.g. basename of an extras path). */
  displayName?: string;
};

export function FolderRow({
  datasetIndex,
  selectedProvider,
  viewMode,
  folderName,
  detectedRepeats,
  effectiveRepeats,
  imageCount,
  augmentation,
  showRepeats,
  isExpanded,
  onToggleExpanded,
  onSetRepeats,
  onUpdateAugment,
  onRemove,
  displayName,
}: FolderRowProps) {
  const isDisabled = effectiveRepeats === 0;
  const label = displayName ?? folderName;
  const isRoot = folderName === 'Root';
  // Kohya/sd-scripts has no vertical-flip augmentation (only `flip_aug`,
  // which is horizontal). ai-toolkit supports both (flip_x / flip_y).
  const supportsVerticalFlip = selectedProvider !== 'kohya';
  const showVerticalFlip = supportsVerticalFlip && augmentation.flipVAugment;
  // Simple mode hides LoRA weight, keep tokens and caption dropout, showing a
  // read-only value instead when one is set — same pattern as native
  // resolution in the Performance section. A hidden control is fine; a hidden
  // value that changes what trains is not.
  const isSimple = viewMode === 'simple';
  // keep_tokens only protects tags from *shuffling*, so it does nothing at all
  // with caption shuffling off (sd-scripts and ai-toolkit both read it that
  // way) — no reason to offer it until shuffling is on.
  const showKeepTokens = augmentation.captionShuffling;

  return (
    <div className={isDisabled ? 'opacity-40' : undefined}>
      <div className="flex items-center justify-between py-1.5 text-sm">
        <div className="flex items-center gap-2 text-slate-800 dark:text-slate-200">
          <Button
            onClick={onToggleExpanded}
            variant="ghost"
            size="sm"
            width="xs"
            title={
              isExpanded ? 'Hide advanced settings' : 'Show advanced settings'
            }
          >
            {isExpanded ? (
              <ChevronDownIcon className="h-3 w-3" />
            ) : (
              <ChevronRightIcon className="h-3 w-3" />
            )}
          </Button>
          <Button
            onClick={() =>
              onSetRepeats(datasetIndex, folderName, isDisabled ? null : 0)
            }
            variant="toggle"
            size="sm"
            title={isDisabled ? 'Include in training' : 'Exclude from training'}
          >
            {isDisabled ? (
              <EyeOffIcon className="h-3 w-3" />
            ) : (
              <EyeIcon className="h-3 w-3" />
            )}
          </Button>
          <span className="flex min-w-0 items-center truncate" title={label}>
            {isRoot ? (
              <HomeIcon className="mr-2 h-4 w-4 shrink-0 text-slate-500" />
            ) : (
              <FolderOpenIcon className="mr-2 h-4 w-4 shrink-0 text-slate-500" />
            )}
            <span className="truncate">{label}</span>
          </span>
        </div>

        {!isDisabled && (
          <div className="flex items-center gap-2 text-slate-500">
            {/* What's switched on for this folder, so the collapsed row still
              tells the story without expanding the panel below. */}
            {augmentation.flipAugment && (
              <span title="Horizontal flipping" className="shrink-0">
                <FlipHorizontal2Icon className="h-4 w-4" aria-hidden />
                <span className="sr-only">Horizontal flipping</span>
              </span>
            )}
            {showVerticalFlip && (
              <span title="Vertical flipping" className="shrink-0">
                <FlipVertical2Icon className="h-4 w-4" aria-hidden />
                <span className="sr-only">Vertical flipping</span>
              </span>
            )}
            {augmentation.isRegularization && (
              <span title="Regularisation set" className="shrink-0">
                <ScaleIcon className="h-4 w-4" aria-hidden />
                <span className="sr-only">Regularisation set</span>
              </span>
            )}

            {imageCount !== undefined && (
              <span className="tabular-nums">
                {imageCount === 1
                  ? `${imageCount} image`
                  : `${imageCount} images`}
              </span>
            )}
            {showRepeats && (
              <>
                <span className="text-slate-400">&times;</span>
                <NumberInput
                  spinner
                  kind="int"
                  min={1}
                  max={100}
                  value={effectiveRepeats}
                  onChange={(val) =>
                    onSetRepeats(
                      datasetIndex,
                      folderName,
                      val === detectedRepeats ? null : val,
                    )
                  }
                  size="sm"
                  className="w-14 text-center"
                />
                <span className="text-slate-400">repeats</span>
              </>
            )}
            {onRemove && (
              <Button
                onClick={onRemove}
                variant="ghost"
                size="sm"
                width="sm"
                title="Remove folder"
              >
                <XIcon />
              </Button>
            )}
          </div>
        )}
      </div>

      {isExpanded && (
        <div className="mb-2 ml-5 grid grid-cols-1 gap-3 rounded border border-slate-200 bg-(--surface)/30 p-3 md:grid-cols-2 dark:border-slate-700">
          <div className="flex flex-wrap content-start gap-2">
            <FormTitle>Horizontal Augmentation</FormTitle>

            <Checkbox
              isSelected={augmentation.flipAugment}
              onChange={() =>
                onUpdateAugment(datasetIndex, folderName, {
                  flipAugment: !augmentation.flipAugment,
                })
              }
              label="Allow horizontal flipping"
            />
            <p className="mt-0.5 text-slate-500">
              <FlipHorizontal2Icon className="h-4.5 w-4.5" />
            </p>
            <p className="text-xs text-slate-500">
              Allow images to be flipped horizontally to increase training
              variety
            </p>
          </div>

          {supportsVerticalFlip && (
            <div className="flex flex-wrap content-start gap-2">
              <FormTitle>Vertical Augmentation</FormTitle>

              <Checkbox
                isSelected={augmentation.flipVAugment}
                onChange={() =>
                  onUpdateAugment(datasetIndex, folderName, {
                    flipVAugment: !augmentation.flipVAugment,
                  })
                }
                label="Allow vertical flipping"
              />
              <p className="mt-0.5 text-slate-500">
                <FlipVertical2Icon className="h-4.5 w-4.5" />
              </p>
              <p className="text-xs text-slate-500">
                Allow images to be flipped vertically to increase training
                variety (unusual)
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <FormTitle>Regularisation Set</FormTitle>
            <Checkbox
              isSelected={augmentation.isRegularization}
              onChange={() =>
                onUpdateAugment(datasetIndex, folderName, {
                  isRegularization: !augmentation.isRegularization,
                })
              }
              label="Images are a regularisation set"
            />
            <p className="mt-0.5 text-slate-500">
              <ScaleIcon className="h-4.5 w-4.5" />
            </p>
            <span className="w-full text-xs text-slate-500">
              Mark these images as class/regularisation data, not training data
            </span>
          </div>

          {!isSimple ? (
            <div>
              <FormTitle>LoRA Weight</FormTitle>
              <NumberInput
                min={0}
                value={augmentation.loraWeight}
                onChange={(val) =>
                  onUpdateAugment(datasetIndex, folderName, { loraWeight: val })
                }
                className="w-20"
                size="sm"
              />
              <p className="mt-0.5 text-xs text-slate-500">
                Scales this folder&apos;s contribution (1 = standard)
              </p>
            </div>
          ) : (
            augmentation.loraWeight !== 1 && (
              <div>
                <FormTitle as="span">LoRA Weight</FormTitle>
                <p className="text-sm font-medium tabular-nums">
                  {augmentation.loraWeight}
                  <span className="ml-2 font-normal text-slate-400">
                    {augmentation.loraWeight > 1
                      ? 'weighted up'
                      : 'weighted down'}
                  </span>
                </p>
              </div>
            )
          )}

          <div className="flex flex-wrap items-center gap-2 md:col-span-2">
            <FormTitle>Captions</FormTitle>
            <Checkbox
              isSelected={augmentation.captionShuffling}
              onChange={() =>
                onUpdateAugment(datasetIndex, folderName, {
                  captionShuffling: !augmentation.captionShuffling,
                })
              }
              label="Shuffle captions"
            />
            <span className="w-full text-xs text-slate-500">
              Randomise tag order during training if tag order is not important
              (<strong>Note:</strong> Do not use with natural language tagging!)
            </span>
          </div>

          {showKeepTokens &&
            (!isSimple ? (
              <div>
                <FormTitle>Keep Tokens</FormTitle>
                <NumberInput
                  spinner
                  kind="int"
                  min={0}
                  value={augmentation.keepTokens}
                  onChange={(val) =>
                    onUpdateAugment(datasetIndex, folderName, {
                      keepTokens: val,
                    })
                  }
                  className="w-20"
                  size="sm"
                />
                <p className="mt-0.5 text-xs text-slate-500">
                  Protects first N tags from shuffling
                </p>
              </div>
            ) : (
              augmentation.keepTokens > 0 && (
                <div>
                  <FormTitle as="span">Keep Tokens</FormTitle>
                  <p className="text-sm font-medium tabular-nums">
                    {augmentation.keepTokens}
                    <span className="ml-2 font-normal text-slate-500">
                      {augmentation.keepTokens === 1 ? 'tag' : 'tags'} kept in
                      place while shuffling
                    </span>
                  </p>
                </div>
              )
            ))}

          {!isSimple ? (
            <div>
              <FormTitle>Caption Dropout</FormTitle>
              <NumberInput
                min={0}
                max={1}
                value={augmentation.captionDropoutRate}
                onChange={(val) =>
                  onUpdateAugment(datasetIndex, folderName, {
                    captionDropoutRate: val,
                  })
                }
                className="w-20"
                size="sm"
              />
              <p className="mt-0.5 text-xs text-slate-500">
                Probability of dropping captions (0 = disabled)
              </p>
            </div>
          ) : (
            augmentation.captionDropoutRate > 0 && (
              <div>
                <FormTitle as="span">Caption Dropout</FormTitle>
                <p className="text-sm font-medium tabular-nums">
                  {Math.round(augmentation.captionDropoutRate * 100)}%
                  <span className="ml-2 font-normal text-slate-400">
                    of captions dropped
                  </span>
                </p>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
