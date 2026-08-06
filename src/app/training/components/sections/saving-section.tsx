import { FolderOpenIcon, InfoIcon } from 'lucide-react';
import { memo, useCallback } from 'react';

import type { TrainingFieldName } from '@/app/services/training/field-registry';
import type { TrainingDefaults } from '@/app/services/training/models';
import { Button } from '@/app/shared/button';
import { Checkbox } from '@/app/shared/checkbox';
import { CollapsibleSection } from '@/app/shared/collapsible-section';
import { Dropdown, type DropdownItem } from '@/app/shared/dropdown';
import { FormTitle } from '@/app/shared/form-title/form-title';
import { Input } from '@/app/shared/input/input';
import { InputTray } from '@/app/shared/input-tray/input-tray';
import { NumberInput } from '@/app/shared/number-input/number-input';
import { SegmentedControl } from '@/app/shared/segmented-control/segmented-control';

import { FieldTitle } from '../field-title';
import type {
  FormState,
  SectionName,
} from '../training-config-form/use-training-config-form';
import { SectionHeaderExtra } from './section-header-extra';
import { SectionResetButton } from './section-reset-button';

type SavingSectionProps = {
  outputName: string;
  saveEnabled: boolean;
  saveMode: 'epochs' | 'steps';
  saveEveryEpochs: number;
  saveEverySteps: number;
  saveFormat: 'fp16' | 'bf16' | 'fp32';
  maxSavesToKeep: number;
  saveState: boolean;
  resumeState: string;
  /** Resolved run length, for working out how many checkpoints the run writes. */
  calculatedSteps: number;
  calculatedEpochs: number;
  hasChanges: boolean;
  defaults: TrainingDefaults;
  visibleFields: Set<TrainingFieldName>;
  hiddenChangesCount?: number;
  onFieldChange: <K extends keyof FormState>(
    field: K,
    value: FormState[K],
  ) => void;
  onOutputNameChange: (name: string) => void;
  onReset: (section: SectionName) => void;
};

const SAVE_FORMAT_ITEMS: DropdownItem<string>[] = [
  { value: 'fp16', label: 'Most Compatible (FP16)' },
  { value: 'bf16', label: 'Newer/Specific Models (BF16)' },
  { value: 'fp32', label: 'Higher Quality, Larger File (FP32)' },
];

const SavingSectionComponent = ({
  outputName,
  saveEnabled,
  saveMode,
  saveEveryEpochs,
  saveEverySteps,
  saveFormat,
  maxSavesToKeep,
  saveState,
  resumeState,
  calculatedSteps,
  calculatedEpochs,
  hasChanges,
  defaults,
  visibleFields,
  hiddenChangesCount,
  onFieldChange,
  onOutputNameChange,
  onReset,
}: SavingSectionProps) => {
  const handleBrowseResumeState = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        title: 'Select training state folder',
        mode: 'folder',
      });
      const res = await fetch(`/api/filesystem/browse?${params}`);
      const data = await res.json();
      if (data.path) onFieldChange('resumeState', data.path);
    } catch {
      // Dialog failed — user can paste the path manually
    }
  }, [onFieldChange]);

  const hasVisibleFields =
    visibleFields.has('saveEveryEpochs') ||
    visibleFields.has('saveEverySteps') ||
    visibleFields.has('outputName') ||
    visibleFields.has('saveFormat');

  if (!hasVisibleFields) return null;

  const activeField =
    saveMode === 'epochs' ? 'saveEveryEpochs' : 'saveEverySteps';
  const activeValue = saveMode === 'epochs' ? saveEveryEpochs : saveEverySteps;

  // How many times the cadence fires across the resolved run length — the same
  // count the sampling tally uses. Both are 0 until a dataset is attached, so
  // the tally is left off until then.
  const checkpoints =
    saveMode === 'epochs'
      ? saveEveryEpochs > 0
        ? Math.floor(calculatedEpochs / saveEveryEpochs)
        : 0
      : saveEverySteps > 0
        ? Math.floor(calculatedSteps / saveEverySteps)
        : 0;

  return (
    <CollapsibleSection
      title="Saving"
      headerExtra={
        <SectionHeaderExtra hiddenChangesCount={hiddenChangesCount} />
      }
      headerActions={(expanded) =>
        hasChanges && expanded ? (
          <SectionResetButton onClick={() => onReset('saving')} />
        ) : undefined
      }
    >
      <div className="space-y-3">
        {/* Output Name + Format row */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          {visibleFields.has('outputName') && (
            <div>
              <FormTitle>Output Name</FormTitle>
              <Input
                type="text"
                value={outputName}
                onChange={(e) => onOutputNameChange(e.target.value)}
                placeholder="my-lora"
                className="w-full"
              />
            </div>
          )}

          {visibleFields.has('saveFormat') && (
            <div>
              <FieldTitle
                field="saveFormat"
                label="Output Precision"
                value={saveFormat}
                defaults={defaults}
                onFieldChange={onFieldChange}
              />
              <Dropdown
                items={SAVE_FORMAT_ITEMS}
                selectedValue={saveFormat}
                onChange={(val) =>
                  onFieldChange('saveFormat', val as FormState['saveFormat'])
                }
                aria-label="Save format"
              />
            </div>
          )}
        </div>

        {/* Save Checkpoints */}
        {(visibleFields.has('saveEveryEpochs') ||
          visibleFields.has('saveEverySteps')) && (
          <>
            <Checkbox
              isSelected={saveEnabled}
              onChange={() => onFieldChange('saveEnabled', !saveEnabled)}
              label="Save checkpoints during training"
              size="sm"
            />

            {saveEnabled && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div>
                  <FormTitle>Save Every</FormTitle>
                  <InputTray size="md">
                    <NumberInput
                      spinner
                      kind="int"
                      min={1}
                      value={activeValue}
                      onChange={(val) => onFieldChange(activeField, val)}
                      className="mr-1 w-20"
                    />
                    <SegmentedControl
                      options={[
                        { value: 'epochs', label: 'Epochs' },
                        { value: 'steps', label: 'Steps' },
                      ]}
                      value={saveMode}
                      onChange={(val) => onFieldChange('saveMode', val)}
                      size="md"
                    />
                  </InputTray>

                  {saveEnabled && checkpoints > 0 && (
                    <p className="mt-2 text-sm text-slate-500 tabular-nums dark:text-slate-400">
                      Will save{' '}
                      <span className="font-medium text-slate-600 dark:text-slate-300">
                        {checkpoints.toLocaleString()}{' '}
                        {checkpoints === 1 ? 'checkpoint' : 'checkpoints'}
                      </span>{' '}
                      over the run
                    </p>
                  )}
                </div>

                {visibleFields.has('maxSavesToKeep') ? (
                  <div>
                    <FieldTitle
                      field="maxSavesToKeep"
                      label="Max Saves to Keep"
                      value={maxSavesToKeep}
                      defaults={defaults}
                      onFieldChange={onFieldChange}
                    />
                    <NumberInput
                      spinner
                      kind="int"
                      min={0}
                      value={maxSavesToKeep}
                      onChange={(val) => onFieldChange('maxSavesToKeep', val)}
                      className="w-24"
                    />
                    <p className="mt-1 text-xs text-slate-400">
                      1 = only the latest, 0 = keep all
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center">
                    <InfoIcon className="mr-1 h-4 w-4 text-slate-600 dark:text-slate-400" />
                    <p className="text-xs text-slate-400">
                      {maxSavesToKeep === 0
                        ? 'Keeps every checkpoint'
                        : maxSavesToKeep === 1
                          ? 'Keeps only the latest checkpoint (earlier ones deleted)'
                          : `Keeps the last ${maxSavesToKeep} checkpoints (earlier ones deleted)`}
                    </p>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Save Training State */}
        {visibleFields.has('saveState') && (
          <div className="flex items-center gap-2">
            <Checkbox
              isSelected={saveState}
              onChange={() => onFieldChange('saveState', !saveState)}
              label="Save full training state"
              size="sm"
            />
            <span className="text-xs text-slate-400">
              Writes optimiser state so training can be resumed
            </span>
          </div>
        )}

        {/* Resume From State */}
        {visibleFields.has('resumeState') && (
          <div>
            <FormTitle>Resume From State</FormTitle>
            <InputTray size="md" width="full">
              <Input
                type="text"
                value={resumeState}
                onChange={(e) => onFieldChange('resumeState', e.target.value)}
                placeholder="Path to a previously saved training-state folder…"
                className="min-w-0 flex-1"
              />
              <Button
                onClick={handleBrowseResumeState}
                variant="ghost"
                size="md"
                width="md"
                title="Browse…"
              >
                <FolderOpenIcon />
              </Button>
            </InputTray>
            <p className="mt-1 text-xs text-slate-400">
              Leave empty to start fresh
            </p>
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
};

export const SavingSection = memo(SavingSectionComponent);
