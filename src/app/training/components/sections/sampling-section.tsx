import { memo } from 'react';

import type { TrainingFieldName } from '@/app/services/training/field-registry';
import type { TrainingDefaults } from '@/app/services/training/models';
import {
  defaultSampleAspect,
  getSampleAspects,
  getSampleBase,
  resolveSampleSize,
  type SampleAspect,
  sampleAspectName,
} from '@/app/services/training/sample-sizes';
import { Checkbox } from '@/app/shared/checkbox';
import { CollapsibleSection } from '@/app/shared/collapsible-section';
import { Dropdown, type DropdownItem } from '@/app/shared/dropdown';
import { FormTitle } from '@/app/shared/form-title/form-title';
import { InputTray } from '@/app/shared/input-tray/input-tray';
import { NumberInput } from '@/app/shared/number-input/number-input';
import { SegmentedControl } from '@/app/shared/segmented-control/segmented-control';

import { FieldTitle } from '../field-title';
import type {
  FormState,
  SectionName,
} from '../training-config-form/use-training-config-form';
import { SamplePrompts } from './sample-prompts/sample-prompts';
import { SectionHeaderExtra } from './section-header-extra';
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
const SAMPLE_SAMPLER_ITEMS: DropdownItem<string>[] = [
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
  /** Index-aligned with `samplePrompts`; may be short on older saved configs. */
  samplePromptSizes: SampleAspect[];
  /** Training resolution, so each aspect can show the pixels it resolves to. */
  resolution: number[];
  /** Kohya-only exact `WxH` training size; empty when unused. */
  nativeResolution: string;
  sampleMode: 'epochs' | 'steps';
  sampleEveryEpochs: number;
  sampleEverySteps: number;
  sampleSteps: number;
  guidanceScale: number;
  sampleSampler: string;
  /** Resolved run length, for working out how many samples the run produces. */
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
  onAddPrompt: () => void;
  onRemovePrompt: (index: number) => void;
  onSetPrompt: (index: number, value: string) => void;
  onSetPromptSize: (index: number, value: SampleAspect) => void;
  onReorderPrompts: (from: number, to: number) => void;
  onReset: (section: SectionName) => void;
};

const SamplingSectionComponent = ({
  samplingEnabled,
  samplePrompts,
  samplePromptSizes,
  resolution,
  nativeResolution,
  sampleMode,
  sampleEveryEpochs,
  sampleEverySteps,
  sampleSteps,
  guidanceScale,
  sampleSampler,
  calculatedSteps,
  calculatedEpochs,
  hasChanges,
  defaults,
  visibleFields,
  hiddenChangesCount,
  onFieldChange,
  onAddPrompt,
  onRemovePrompt,
  onSetPrompt,
  onSetPromptSize,
  onReorderPrompts,
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

  // Aspects resolve against the run's training size, so the menu can name the
  // pixels each shape actually produces rather than a fixed 1024-family guess.
  const sampleBase = getSampleBase(resolution, nativeResolution);
  const fallbackAspect = defaultSampleAspect(sampleBase);
  const aspectItems: DropdownItem<SampleAspect>[] = getSampleAspects(
    sampleBase,
  ).map((aspect) => {
    const [w, h] = resolveSampleSize(aspect, sampleBase);
    return {
      value: aspect,
      label: (
        <span className="flex items-baseline gap-2">
          <span className="tabular-nums">
            {w} × {h}
          </span>
          <span className="text-slate-400 dark:text-slate-500">
            {sampleAspectName(aspect)}
          </span>
        </span>
      ),
    };
  });

  // Kept as pairs rather than two filtered lists: dropping the empty prompts
  // shifts the indices, and a shape has to stay with its prompt.
  const prompts = samplePrompts
    .map((text, i) => ({
      text: text.trim(),
      aspect: samplePromptSizes[i] ?? fallbackAspect,
    }))
    .filter((p) => p.text !== '');

  // How many times the cadence fires across the resolved run length. Both
  // are 0 until a dataset is attached, so the tally is left off until then.
  const rounds =
    sampleMode === 'epochs'
      ? sampleEveryEpochs > 0
        ? Math.floor(calculatedEpochs / sampleEveryEpochs)
        : 0
      : sampleEverySteps > 0
        ? Math.floor(calculatedSteps / sampleEverySteps)
        : 0;
  const totalImages = rounds * prompts.length;

  // Shared by the read-only Simple summary and the editable tiers, so the
  // cost of a cadence/prompt change is visible wherever it can be changed.
  const tally = totalImages > 0 && (
    <p className="mt-2 text-sm text-slate-500 tabular-nums dark:text-slate-400">
      {rounds} {rounds === 1 ? 'round' : 'rounds'} &times; {prompts.length}{' '}
      {prompts.length === 1 ? 'prompt' : 'prompts'} ={' '}
      <span className="font-medium text-slate-600 dark:text-slate-300">
        {totalImages.toLocaleString()} {totalImages === 1 ? 'image' : 'images'}
      </span>{' '}
      over the run
    </p>
  );

  // Simple view hides every sampling control, but if sampling was switched on
  // in a higher tier the run will still generate images — show a read-only
  // summary of what's coming so the setting isn't invisible. With sampling
  // off there's nothing to say, so the section disappears as before.
  if (!hasVisibleFields) {
    if (!samplingEnabled) return null;

    const cadence =
      sampleMode === 'epochs'
        ? `${sampleEveryEpochs === 1 ? 'epoch' : `${sampleEveryEpochs} epochs`}`
        : `${sampleEverySteps === 1 ? 'step' : `${sampleEverySteps} steps`}`;

    return (
      <CollapsibleSection title="Sample Images">
        <div className="space-y-1.5 text-sm">
          <p className="text-slate-500 dark:text-slate-400">
            Sample images will be generated every {cadence}
            {prompts.length > 0 ? ' from these prompts:' : '.'}
          </p>
          {prompts.length > 0 && (
            <ul className="ml-4 list-disc space-y-0.5">
              {prompts.map((prompt, i) => {
                const [w, h] = resolveSampleSize(prompt.aspect, sampleBase);
                return (
                  <li key={i} className="text-slate-600 dark:text-slate-300">
                    <span className="inline-flex max-w-full items-baseline gap-1.5 align-bottom">
                      <span className="min-w-0 truncate" title={prompt.text}>
                        {prompt.text}
                      </span>
                      <span className="shrink-0 text-slate-400 tabular-nums dark:text-slate-500">
                        {w} × {h}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {tally}
        </div>
      </CollapsibleSection>
    );
  }

  return (
    <CollapsibleSection
      title="Sampling"
      headerExtra={
        <SectionHeaderExtra hiddenChangesCount={hiddenChangesCount} />
      }
      headerActions={(expanded) =>
        hasChanges && expanded ? (
          <SectionResetButton onClick={() => onReset('sampling')} />
        ) : undefined
      }
    >
      <div className="space-y-3">
        {/* Enable Sampling */}
        {visibleFields.has('samplingEnabled') && (
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
            {visibleFields.has('samplePrompts') && (
              <SamplePrompts
                prompts={samplePrompts}
                sizes={samplePromptSizes}
                fallbackAspect={fallbackAspect}
                sampleBase={sampleBase}
                aspectItems={aspectItems}
                onAdd={onAddPrompt}
                onRemove={onRemovePrompt}
                onSet={onSetPrompt}
                onSetSize={onSetPromptSize}
                onReorder={onReorderPrompts}
              />
            )}

            {/* Frequency + Steps + Guidance + Noise row */}
            <div className="grid grid-cols-4 gap-x-4 gap-y-3">
              {(visibleFields.has('sampleEveryEpochs') ||
                visibleFields.has('sampleEverySteps')) && (
                // Same tray treatment as the Saving section's "Save Every",
                // so the two cadence controls read as the same kind of thing.
                // Spans two columns — the tray needs the width.
                <div className="col-span-2">
                  <FormTitle>Generate Every</FormTitle>
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
                      value={sampleMode}
                      onChange={(val) => onFieldChange('sampleMode', val)}
                      size="md"
                    />
                  </InputTray>

                  {tally}
                </div>
              )}

              {visibleFields.has('sampleSteps') && (
                <div>
                  <FieldTitle
                    field="sampleSteps"
                    label="Sample Steps"
                    value={sampleSteps}
                    defaults={defaults}
                    onFieldChange={onFieldChange}
                  />
                  <NumberInput
                    spinner
                    kind="int"
                    min={1}
                    max={100}
                    value={sampleSteps}
                    onChange={(val) => onFieldChange('sampleSteps', val)}
                    className="w-20"
                  />
                </div>
              )}

              {visibleFields.has('guidanceScale') && (
                <div>
                  <FieldTitle
                    field="guidanceScale"
                    label="Guidance Scale"
                    value={guidanceScale}
                    defaults={defaults}
                    onFieldChange={onFieldChange}
                  />
                  <NumberInput
                    min={0}
                    value={guidanceScale}
                    onChange={(val) => onFieldChange('guidanceScale', val)}
                    className="w-full"
                  />
                </div>
              )}

              {visibleFields.has('sampleSampler') && (
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
