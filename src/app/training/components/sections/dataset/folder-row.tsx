import {
  ChevronDownIcon,
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  FolderOpenIcon,
  HomeIcon,
  XIcon,
} from 'lucide-react';

import { Button } from '@/app/shared/button';
import { Checkbox } from '@/app/shared/checkbox';
import { FormTitle } from '@/app/shared/form-title/form-title';
import { Input } from '@/app/shared/input/input';

import type { FolderAugmentation } from '../../training-config-form/use-training-config-form';

type FolderRowProps = {
  datasetIndex: number | null; // null = extra folder
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

  return (
    <div className={isDisabled ? 'opacity-40' : undefined}>
      <div className="flex items-center justify-between py-1.5 text-sm">
        <div className="flex items-center gap-2 text-slate-500">
          <Button
            onClick={onToggleExpanded}
            variant="ghost"
            size="sm"
            width="xs"
            title={isExpanded ? 'Hide folder settings' : 'Folder settings'}
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
              <HomeIcon className="mr-2 h-4 w-4 shrink-0 text-slate-400 dark:text-slate-600" />
            ) : (
              <FolderOpenIcon className="mr-2 h-4 w-4 shrink-0 text-slate-400 dark:text-slate-600" />
            )}
            <span className="truncate">{label}</span>
          </span>
        </div>

        {!isDisabled && (
          <div className="flex items-center gap-2">
            {imageCount !== undefined && (
              <span className="text-slate-400 tabular-nums">
                {imageCount === 1
                  ? `${imageCount} image`
                  : `${imageCount} images`}
              </span>
            )}
            {showRepeats && (
              <>
                <span className="text-slate-400">&times;</span>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={effectiveRepeats}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (val > 0) {
                      onSetRepeats(
                        datasetIndex,
                        folderName,
                        val === detectedRepeats ? null : val,
                      );
                    }
                  }}
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
                width="xs"
                title="Remove folder"
              >
                <XIcon className="h-3 w-3" />
              </Button>
            )}
          </div>
        )}
      </div>

      {isExpanded && (
        <div className="mb-2 ml-8 grid grid-cols-1 gap-3 rounded border border-(--border-subtle) bg-(--surface)/30 p-3 md:grid-cols-2">
          <div className="flex items-center gap-2 md:col-span-2">
            <Checkbox
              isSelected={augmentation.captionShuffling}
              onChange={() =>
                onUpdateAugment(datasetIndex, folderName, {
                  captionShuffling: !augmentation.captionShuffling,
                })
              }
              label="Shuffle captions"
              size="sm"
            />
            <span className="text-xs text-slate-400">
              Randomise tag order during training
            </span>
          </div>

          <div>
            <FormTitle>
              Keep Tokens
            </FormTitle>
            <Input
              type="number"
              min={0}
              value={augmentation.keepTokens}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val) && val >= 0) {
                  onUpdateAugment(datasetIndex, folderName, {
                    keepTokens: val,
                  });
                }
              }}
              className="w-20 tabular-nums"
              size="sm"
            />
            <p className="mt-0.5 text-xs text-slate-400">
              Protects first N tags from shuffling
              {!augmentation.captionShuffling && ' (requires Shuffle Captions)'}
            </p>
          </div>

          <div>
            <FormTitle>
              Caption Dropout
            </FormTitle>
            <Input
              type="text"
              value={augmentation.captionDropoutRate}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val) && val >= 0 && val <= 1) {
                  onUpdateAugment(datasetIndex, folderName, {
                    captionDropoutRate: val,
                  });
                }
              }}
              className="w-20 tabular-nums"
              size="sm"
            />
            <p className="mt-0.5 text-xs text-slate-400">
              Probability of dropping captions (0 = disabled)
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              isSelected={augmentation.flipAugment}
              onChange={() =>
                onUpdateAugment(datasetIndex, folderName, {
                  flipAugment: !augmentation.flipAugment,
                })
              }
              label="Flip horizontally"
              size="sm"
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              isSelected={augmentation.flipVAugment}
              onChange={() =>
                onUpdateAugment(datasetIndex, folderName, {
                  flipVAugment: !augmentation.flipVAugment,
                })
              }
              label="Flip vertically"
              size="sm"
            />
          </div>

          <div>
            <FormTitle>
              LoRA Weight
            </FormTitle>
            <Input
              type="text"
              value={augmentation.loraWeight}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val) && val >= 0) {
                  onUpdateAugment(datasetIndex, folderName, {
                    loraWeight: val,
                  });
                }
              }}
              className="w-20 tabular-nums"
              size="sm"
            />
            <p className="mt-0.5 text-xs text-slate-400">
              Scales this folder&apos;s contribution (1 = standard)
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              isSelected={augmentation.isRegularization}
              onChange={() =>
                onUpdateAugment(datasetIndex, folderName, {
                  isRegularization: !augmentation.isRegularization,
                })
              }
              label="Regularisation set"
              size="sm"
            />
            <span className="text-xs text-slate-400">
              Treat as class/regularisation data, not training data
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
