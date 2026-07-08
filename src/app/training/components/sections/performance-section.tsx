import { memo } from 'react';

import type { TrainingProvider } from '@/app/services/training/types';
import { Checkbox } from '@/app/shared/checkbox';
import { CollapsibleSection } from '@/app/shared/collapsible-section';
import { Dropdown, type DropdownItem } from '@/app/shared/dropdown';
import { FormTitle } from '@/app/shared/form-title/form-title';
import { Input } from '@/app/shared/input/input';

import type {
  FormState,
  SectionName,
} from '../training-config-form/use-training-config-form';
import { SectionResetButton } from './section-reset-button';

type PerformanceSectionProps = {
  /** Read-only, for effective batch size display in gradient accumulation */
  batchSize: number;
  resolution: number[];
  availableResolutions: number[];
  provider: TrainingProvider;
  mixedPrecision: 'bf16' | 'fp16';
  transformerQuantization: 'none' | 'float8';
  textEncoderQuantization: 'none' | 'float8';
  cacheTextEmbeddings: boolean;
  unloadTextEncoder: boolean;
  gradientAccumulationSteps: number;
  gradientCheckpointing: boolean;
  cacheLatents: boolean;
  hasChanges: boolean;
  visibleFields: Set<string>;
  hiddenChangesCount?: number;
  onFieldChange: <K extends keyof FormState>(
    field: K,
    value: FormState[K],
  ) => void;
  onReset: (section: SectionName) => void;
};

const PRECISION_ITEMS: DropdownItem<string>[] = [
  { value: 'bf16', label: 'Modern GPU - BF16 Floating Point' },
  { value: 'fp16', label: 'Compatibility - FP16 Floating Point' },
];

const QUANTIZATION_ITEMS: DropdownItem<string>[] = [
  { value: 'none', label: 'None (full precision)' },
  { value: 'float8', label: 'float8 (lower VRAM)' },
];

const PerformanceSectionComponent = ({
  batchSize,
  resolution,
  availableResolutions,
  provider,
  mixedPrecision,
  transformerQuantization,
  textEncoderQuantization,
  cacheTextEmbeddings,
  unloadTextEncoder,
  gradientAccumulationSteps,
  gradientCheckpointing,
  cacheLatents,
  hasChanges,
  visibleFields,
  hiddenChangesCount,
  onFieldChange,
  onReset,
}: PerformanceSectionProps) => {
  const isKohya = provider === 'kohya';

  const hasVisibleFields =
    visibleFields.has('resolution') ||
    visibleFields.has('mixedPrecision') ||
    visibleFields.has('transformerQuantization') ||
    visibleFields.has('textEncoderQuantization') ||
    visibleFields.has('cacheTextEmbeddings') ||
    visibleFields.has('unloadTextEncoder') ||
    visibleFields.has('gradientAccumulationSteps') ||
    visibleFields.has('gradientCheckpointing') ||
    visibleFields.has('cacheLatents');

  if (!hasVisibleFields) return null;

  const handleToggleResolution = (res: number) => {
    if (isKohya) {
      // Kohya: single-select — replace the entire array
      onFieldChange('resolution', [res]);
      return;
    }
    // ai-toolkit: multi-select toggle
    if (resolution.includes(res)) {
      if (resolution.length > 1) {
        onFieldChange(
          'resolution',
          resolution.filter((r) => r !== res),
        );
      }
    } else {
      onFieldChange(
        'resolution',
        [...resolution, res].sort((a, b) => a - b),
      );
    }
  };

  return (
    <CollapsibleSection
      title="Performance"
      headerExtra={
        <>
          {hasChanges && (
            <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
          )}
          {hiddenChangesCount ? (
            <span className="text-xs text-amber-500/70">
              {hiddenChangesCount} hidden{' '}
              {hiddenChangesCount === 1 ? 'setting' : 'settings'} customised
            </span>
          ) : undefined}
        </>
      }
      headerActions={(expanded) =>
        hasChanges && expanded ? (
          <SectionResetButton onClick={() => onReset('performance')} />
        ) : undefined
      }
    >
      <div className="space-y-3">
        {/* Precision + Quantization row */}
        <div className="grid grid-cols-3 gap-x-4 gap-y-3">
          {visibleFields.has('mixedPrecision' satisfies keyof FormState) && (
            <div>
              <FormTitle>Training Precision</FormTitle>
              <Dropdown
                items={PRECISION_ITEMS}
                selectedValue={mixedPrecision}
                onChange={(val) =>
                  onFieldChange(
                    'mixedPrecision',
                    val as FormState['mixedPrecision'],
                  )
                }
                aria-label="Training precision"
              />
              <p className="mt-1 text-xs text-slate-400">
                BF16 is more stable on RTX 3000+
              </p>
            </div>
          )}

          {visibleFields.has(
            'transformerQuantization' satisfies keyof FormState,
          ) && (
            <div>
              <FormTitle>Transformer Quantization</FormTitle>
              <Dropdown
                items={QUANTIZATION_ITEMS}
                selectedValue={transformerQuantization}
                onChange={(val) =>
                  onFieldChange(
                    'transformerQuantization',
                    val as FormState['transformerQuantization'],
                  )
                }
                aria-label="Transformer quantization"
              />
              <p className="mt-1 text-xs text-slate-400">
                Quantise weights to save VRAM
              </p>
            </div>
          )}

          {visibleFields.has(
            'textEncoderQuantization' satisfies keyof FormState,
          ) && (
            <div>
              <FormTitle>Text Encoder Quantization</FormTitle>
              <Dropdown
                items={QUANTIZATION_ITEMS}
                selectedValue={textEncoderQuantization}
                onChange={(val) =>
                  onFieldChange(
                    'textEncoderQuantization',
                    val as FormState['textEncoderQuantization'],
                  )
                }
                aria-label="Text encoder quantization"
              />
              <p className="mt-1 text-xs text-slate-400">
                T5, CLIP or Qwen encoders
              </p>
            </div>
          )}
        </div>

        {/* Resolution */}
        {visibleFields.has('resolution' satisfies keyof FormState) && (
          <div>
            <FormTitle>
              {isKohya ? 'Base Resolution' : 'Training Resolutions'}
            </FormTitle>
            <div className="flex flex-wrap gap-1.5">
              {availableResolutions.map((res) => {
                const isActive = resolution.includes(res);
                return (
                  <button
                    key={res}
                    type="button"
                    onClick={() => handleToggleResolution(res)}
                    className={`cursor-pointer rounded-sm border px-3 py-1 text-xs font-medium tabular-nums transition-colors ${
                      isActive
                        ? 'border-sky-400 bg-sky-100 text-sky-700 dark:border-sky-600 dark:bg-sky-900/40 dark:text-sky-300'
                        : 'border-(--border-subtle) text-slate-400 hover:border-slate-400 hover:text-slate-600 dark:hover:border-slate-500 dark:hover:text-slate-300'
                    }`}
                  >
                    {res}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Gradient Accumulation */}
        {visibleFields.has(
          'gradientAccumulationSteps' satisfies keyof FormState,
        ) && (
          <div className="grid grid-cols-4 gap-x-4">
            <div>
              <FormTitle>Gradient Accumulation Steps</FormTitle>
              <Input
                type="number"
                min={1}
                max={16}
                value={gradientAccumulationSteps}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (val > 0) onFieldChange('gradientAccumulationSteps', val);
                }}
                className="w-full"
              />
              {gradientAccumulationSteps > 1 && (
                <p className="mt-1 text-xs text-slate-400">
                  Effective batch size:{' '}
                  <span className="font-medium">
                    {batchSize * gradientAccumulationSteps}
                  </span>{' '}
                  ({batchSize} &times; {gradientAccumulationSteps})
                </p>
              )}
            </div>
          </div>
        )}

        {/* Checkboxes */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {visibleFields.has(
            'cacheTextEmbeddings' satisfies keyof FormState,
          ) && (
            <div className="flex items-center gap-2">
              <Checkbox
                isSelected={cacheTextEmbeddings}
                onChange={() =>
                  onFieldChange('cacheTextEmbeddings', !cacheTextEmbeddings)
                }
                label="Cache Text Embeddings"
                size="sm"
              />
              <span className="text-xs text-slate-400">
                Pre-compute once, reuse every epoch
              </span>
            </div>
          )}

          {visibleFields.has('unloadTextEncoder' satisfies keyof FormState) && (
            <div className="flex items-center gap-2">
              <Checkbox
                isSelected={unloadTextEncoder}
                onChange={() =>
                  onFieldChange('unloadTextEncoder', !unloadTextEncoder)
                }
                label="Unload Text Encoder"
                size="sm"
              />
              <span className="text-xs text-slate-400">
                Drop TE from VRAM after caching
              </span>
            </div>
          )}

          {visibleFields.has(
            'gradientCheckpointing' satisfies keyof FormState,
          ) && (
            <div className="flex items-center gap-2">
              <Checkbox
                isSelected={gradientCheckpointing}
                onChange={() =>
                  onFieldChange('gradientCheckpointing', !gradientCheckpointing)
                }
                label="Gradient Checkpointing"
                size="sm"
              />
              <span className="text-xs text-slate-400">
                Reduces VRAM at cost of speed
              </span>
            </div>
          )}

          {visibleFields.has('cacheLatents' satisfies keyof FormState) && (
            <div className="flex items-center gap-2">
              <Checkbox
                isSelected={cacheLatents}
                onChange={() => onFieldChange('cacheLatents', !cacheLatents)}
                label="Cache Latents"
                size="sm"
              />
              <span className="text-xs text-slate-400">
                Caches VAE outputs for faster training
              </span>
            </div>
          )}
        </div>
      </div>
    </CollapsibleSection>
  );
};

/** Informational preview of Kohya bucketing for a given base resolution. */
export const PerformanceSection = memo(PerformanceSectionComponent);
