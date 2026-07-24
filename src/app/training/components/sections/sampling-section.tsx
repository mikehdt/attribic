import { PlusIcon, XIcon } from 'lucide-react';
import { memo } from 'react';

import type { TrainingDefaults } from '@/app/services/training/models';
import { Checkbox } from '@/app/shared/checkbox';
import { CollapsibleSection } from '@/app/shared/collapsible-section';
import { Dropdown, type DropdownItem } from '@/app/shared/dropdown';
import { FormTitle } from '@/app/shared/form-title/form-title';
import { Input } from '@/app/shared/input/input';
import { InputTray } from '@/app/shared/input-tray/input-tray';
import { SegmentedControl } from '@/app/shared/segmented-control/segmented-control';

import { FieldTitle } from '../field-title';
import type {
  FormState,
  SectionName,
} from '../training-config-form/use-training-config-form';
import { SectionResetButton } from './section-reset-button';

/**
 * Sampler choices shared by both backends. Verified against each backend's
 * actual accepted values rather than guessed:
 *  - ai-toolkit (`toolkit/sampler.py` get_sampler): ddim, ddpm, pndm,
 *    lms/k_lms, euler/k_euler, euler_a, dpmsolver/dpmsolver++ (+k_ variants),
 *    dpmsingle, heun, dpm_2, dpm_2_a, lcm, custom_lcm, mean_flow, flowmatch.
 *  - sd-scripts (`library/args.py` --sample_sampler choices): ddim, pndm,
 *    lms, euler, euler_a, heun, dpm_2, dpm_2_a, dpmsolver, dpmsolver++,
 *    dpmsingle, k_lms, k_euler, k_euler_a, k_dpm_2, k_dpm_2_a.
 * This list is the intersection (values valid verbatim on both), trimmed to
 * the handful users actually reach for. Flow-matching ai-toolkit models
 * (Flux/Z-Image/Wan/LTX) always sample with "flowmatch" regardless of this
 * choice — the sidecar overrides it for those archs since anything else
 * would build the wrong scheduler class for a flow-matching transformer.
 */
export const SAMPLE_SAMPLER_ITEMS: DropdownItem<string>[] = [
  { value: 'euler_a', label: 'Euler Ancestral' },
  { value: 'euler', label: 'Euler' },
  { value: 'ddim', label: 'DDIM' },
  { value: 'dpmsolver++', label: 'DPM Solver++' },
  { value: 'heun', label: 'Heun' },
  { value: 'pndm', label: 'PNDM' },
];

type SamplingSectionProps = {
  samplingEnabled: boolean;
  samplePrompts: string[];
  sampleMode: 'epochs' | 'steps';
  sampleEveryEpochs: number;
  sampleEverySteps: number;
  sampleSteps: number;
  guidanceScale: number;
  sampleSampler: string;
  defaults: TrainingDefaults;
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
  sampleSampler,
  defaults,
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
    visibleFields.has('sampleSampler');

  // Simple view hides every sampling control, but if sampling was switched on
  // in a higher tier the run will still generate images — show a read-only
  // summary of what's coming so the setting isn't invisible. With sampling
  // off there's nothing to say, so the section disappears as before.
  if (!hasVisibleFields) {
    if (!samplingEnabled) return null;

    const cadence =
      sampleMode === 'epochs'
        ? `every ${sampleEveryEpochs === 1 ? 'epoch' : `${sampleEveryEpochs} epochs`}`
        : `every ${sampleEverySteps === 1 ? 'step' : `${sampleEverySteps} steps`}`;
    const prompts = samplePrompts.filter((p) => p.trim() !== '');

    return (
      <CollapsibleSection title="Sampling">
        <div className="space-y-1.5 text-sm">
          <p className="text-slate-500 dark:text-slate-400">
            Sample images will be generated {cadence}
            {prompts.length > 0 ? ' from these prompts:' : '.'}
          </p>
          {prompts.length > 0 && (
            <ul className="space-y-0.5">
              {prompts.map((prompt, i) => (
                <li
                  key={i}
                  title={prompt}
                  className="truncate text-slate-600 dark:text-slate-300"
                >
                  {prompt}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-slate-400">
            Configured in the Intermediate view.
          </p>
        </div>
      </CollapsibleSection>
    );
  }

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
                // Same tray treatment as the Saving section's "Save Every",
                // so the two cadence controls read as the same kind of thing.
                // Spans two columns — the tray needs the width.
                <div className="col-span-2">
                  <FormTitle>Generate Every</FormTitle>
                  <InputTray size="md">
                    <Input
                      type="number"
                      min={1}
                      value={activeValue}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (val > 0) onFieldChange(activeField, val);
                      }}
                      className="mr-1 w-20"
                    />
                    <SegmentedControl
                      options={[
                        { value: 'epochs', label: 'Epochs' },
                        { value: 'steps', label: 'Steps' },
                      ]}
                      value={sampleMode}
                      onChange={(val) => onFieldChange('sampleMode', val)}
                      size="md"
                    />
                  </InputTray>
                </div>
              )}

              {visibleFields.has('sampleSteps' satisfies keyof FormState) && (
                <div>
                  <FieldTitle
                    field="sampleSteps"
                    label="Sample Steps"
                    value={sampleSteps}
                    defaults={defaults}
                    onFieldChange={onFieldChange}
                  />
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
                  <FieldTitle
                    field="guidanceScale"
                    label="Guidance Scale"
                    value={guidanceScale}
                    defaults={defaults}
                    onFieldChange={onFieldChange}
                  />
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

              {visibleFields.has('sampleSampler' satisfies keyof FormState) && (
                <div>
                  <FieldTitle
                    field="sampleSampler"
                    label="Sampler"
                    value={sampleSampler}
                    defaults={defaults}
                    onFieldChange={onFieldChange}
                  />
                  <Dropdown
                    items={SAMPLE_SAMPLER_ITEMS}
                    selectedValue={sampleSampler}
                    onChange={(val) => onFieldChange('sampleSampler', val)}
                    fullWidth
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
