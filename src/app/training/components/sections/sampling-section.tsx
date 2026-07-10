import { PlusIcon, XIcon } from 'lucide-react';
import { memo } from 'react';

import { Checkbox } from '@/app/shared/checkbox';
import { CollapsibleSection } from '@/app/shared/collapsible-section';
import { FormTitle } from '@/app/shared/form-title/form-title';
import { Input } from '@/app/shared/input/input';
import { SegmentedControl } from '@/app/shared/segmented-control/segmented-control';

import type {
  FormState,
  SectionName,
} from '../training-config-form/use-training-config-form';
import { SectionResetButton } from './section-reset-button';

type SamplingSectionProps = {
  samplingEnabled: boolean;
  samplePrompts: string[];
  sampleMode: 'epochs' | 'steps';
  sampleEveryEpochs: number;
  sampleEverySteps: number;
  sampleSteps: number;
  guidanceScale: number;
  noiseScheduler: string;
  visibleFields: Set<string>;
  hiddenChangesCount?: number;
  onFieldChange: <K extends keyof FormState>(
    field: K,
    value: FormState[K],
  ) => void;
  onAddPrompt: () => void;
  onRemovePrompt: (index: number) => void;
  onSetPrompt: (index: number, value: string) => void;
  onReset: (section: SectionName) => void;
};

const SamplingSectionComponent = ({
  samplingEnabled,
  samplePrompts,
  sampleMode,
  sampleEveryEpochs,
  sampleEverySteps,
  sampleSteps,
  guidanceScale,
  noiseScheduler,
  visibleFields,
  hiddenChangesCount,
  onFieldChange,
  onAddPrompt,
  onRemovePrompt,
  onSetPrompt,
  onReset,
}: SamplingSectionProps) => {
  const activeField =
    sampleMode === 'epochs' ? 'sampleEveryEpochs' : 'sampleEverySteps';
  const activeValue =
    sampleMode === 'epochs' ? sampleEveryEpochs : sampleEverySteps;

  const hasVisibleFields =
    visibleFields.has('samplingEnabled') ||
    visibleFields.has('samplePrompts') ||
    visibleFields.has('sampleEveryEpochs') ||
    visibleFields.has('sampleEverySteps') ||
    visibleFields.has('sampleSteps') ||
    visibleFields.has('guidanceScale') ||
    visibleFields.has('noiseScheduler');

  if (!hasVisibleFields) return null;

  return (
    <CollapsibleSection
      title="Sampling"
      headerExtra={
        hiddenChangesCount ? (
          <span className="text-xs text-amber-500/70">
            {hiddenChangesCount} hidden{' '}
            {hiddenChangesCount === 1 ? 'setting' : 'settings'} customised
          </span>
        ) : undefined
      }
      headerActions={(expanded) =>
        samplingEnabled && expanded ? (
          <SectionResetButton onClick={() => onReset('sampling')} />
        ) : undefined
      }
    >
      <div className="space-y-3">
        {/* Enable Sampling */}
        {visibleFields.has('samplingEnabled' satisfies keyof FormState) && (
          <Checkbox
            isSelected={samplingEnabled}
            onChange={() => onFieldChange('samplingEnabled', !samplingEnabled)}
            label="Generate sample images during training"
            size="sm"
          />
        )}

        {samplingEnabled && (
          <>
            {/* Sample Prompts — full width */}
            {visibleFields.has('samplePrompts' satisfies keyof FormState) && (
              <div>
                <FormTitle>Sample Prompts</FormTitle>
                <div className="space-y-1.5">
                  {samplePrompts.map((prompt, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <Input
                        type="text"
                        value={prompt}
                        onChange={(e) => onSetPrompt(i, e.target.value)}
                        placeholder="e.g. a woman with red hair, sitting at a cafe"
                        className="flex-1"
                      />
                      {samplePrompts.length > 1 && (
                        <button
                          type="button"
                          onClick={() => onRemovePrompt(i)}
                          className="cursor-pointer rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
                          title="Remove prompt"
                        >
                          <XIcon className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={onAddPrompt}
                  className="mt-1.5 flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
                >
                  <PlusIcon className="h-3 w-3" />
                  Add prompt
                </button>
              </div>
            )}

            {/* Frequency + Steps + Guidance + Noise row */}
            <div className="grid grid-cols-4 gap-x-4 gap-y-3">
              {(visibleFields.has(
                'sampleEveryEpochs' satisfies keyof FormState,
              ) ||
                visibleFields.has(
                  'sampleEverySteps' satisfies keyof FormState,
                )) && (
                <div>
                  <FormTitle>Generate Every</FormTitle>
                  <Input
                    type="number"
                    min={1}
                    value={activeValue}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (val > 0) onFieldChange(activeField, val);
                    }}
                    className="w-full"
                  />
                  <SegmentedControl
                    options={[
                      { value: 'epochs', label: 'Epochs' },
                      { value: 'steps', label: 'Steps' },
                    ]}
                    value={sampleMode}
                    onChange={(val) => onFieldChange('sampleMode', val)}
                    size="sm"
                  />
                </div>
              )}

              {visibleFields.has('sampleSteps' satisfies keyof FormState) && (
                <div>
                  <FormTitle>Sample Steps</FormTitle>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={sampleSteps}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (val > 0) onFieldChange('sampleSteps', val);
                    }}
                    className="w-full"
                  />
                </div>
              )}

              {visibleFields.has('guidanceScale' satisfies keyof FormState) && (
                <div>
                  <FormTitle>Guidance Scale</FormTitle>
                  <Input
                    type="text"
                    value={guidanceScale}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      if (!isNaN(val) && val >= 0)
                        onFieldChange('guidanceScale', val);
                    }}
                    className="w-full tabular-nums"
                  />
                </div>
              )}

              {visibleFields.has(
                'noiseScheduler' satisfies keyof FormState,
              ) && (
                <div>
                  <FormTitle>Noise Scheduler</FormTitle>
                  <Input
                    type="text"
                    value={noiseScheduler}
                    onChange={(e) =>
                      onFieldChange('noiseScheduler', e.target.value)
                    }
                    className="w-full"
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </CollapsibleSection>
  );
};

export const SamplingSection = memo(SamplingSectionComponent);
