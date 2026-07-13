import { memo } from 'react';

import type { TrainingDefaults } from '@/app/services/training/models';
import { parseNativeResolution } from '@/app/services/training/native-resolution';
import type { TrainingProvider } from '@/app/services/training/types';
import { Checkbox } from '@/app/shared/checkbox';
import { CollapsibleSection } from '@/app/shared/collapsible-section';
import { Dropdown, type DropdownItem } from '@/app/shared/dropdown';
import { Input } from '@/app/shared/input/input';
import type { TrainingViewMode } from '@/app/store/preferences';

import { FieldTitle } from '../field-title';
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
  nativeResolution: string;
  viewMode: TrainingViewMode;
  provider: TrainingProvider;
  mixedPrecision: 'bf16' | 'fp16';
  transformerQuantization: 'none' | 'float8';
  textEncoderQuantization: 'none' | 'float8';
  cacheTextEmbeddings: boolean;
  unloadTextEncoder: boolean;
  gradientAccumulationSteps: number;
  gradientCheckpointing: boolean;
  cacheLatents: boolean;
  bucketResoSteps: number;
  bucketNoUpscale: boolean;
  blocksToSwap: number;
  lowVram: boolean;
  hasChanges: boolean;
  defaults: TrainingDefaults;
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
  nativeResolution,
  viewMode,
  provider,
  mixedPrecision,
  transformerQuantization,
  textEncoderQuantization,
  cacheTextEmbeddings,
  unloadTextEncoder,
  gradientAccumulationSteps,
  gradientCheckpointing,
  cacheLatents,
  bucketResoSteps,
  bucketNoUpscale,
  blocksToSwap,
  lowVram,
  hasChanges,
  defaults,
  visibleFields,
  hiddenChangesCount,
  onFieldChange,
  onReset,
}: PerformanceSectionProps) => {
  const isKohya = provider === 'kohya';

  const hasVisibleFields =
    visibleFields.has('resolution') ||
    visibleFields.has('nativeResolution') ||
    visibleFields.has('mixedPrecision') ||
    visibleFields.has('transformerQuantization') ||
    visibleFields.has('textEncoderQuantization') ||
    visibleFields.has('cacheTextEmbeddings') ||
    visibleFields.has('unloadTextEncoder') ||
    visibleFields.has('gradientAccumulationSteps') ||
    visibleFields.has('gradientCheckpointing') ||
    visibleFields.has('cacheLatents') ||
    visibleFields.has('bucketResoSteps') ||
    visibleFields.has('bucketNoUpscale') ||
    visibleFields.has('blocksToSwap') ||
    visibleFields.has('lowVram');

  if (!hasVisibleFields) return null;

  // An exact WxH size takes precedence over the resolution list (see the
  // sidecar's Kohya provider, which drops bucketing entirely when it's set).
  // Validate here so a typo surfaces in the form rather than failing the job.
  const isSimple = viewMode === 'simple';
  const nativeActive = nativeResolution.trim().length > 0;
  const { value: native, error: nativeError } =
    parseNativeResolution(nativeResolution);

  // Multi-select on both backends. ai-toolkit trains each selected size;
  // Kohya trains at the largest and enables aspect bucketing across the
  // min–max range when more than one is selected (the sidecar derives
  // enable_bucket / min_bucket_reso / max_bucket_reso from this list).
  const handleToggleResolution = (res: number) => {
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
              <FieldTitle
                field="mixedPrecision"
                label="Training Precision"
                value={mixedPrecision}
                defaults={defaults}
                onFieldChange={onFieldChange}
              />
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
              <FieldTitle
                field="transformerQuantization"
                label="Transformer Quantization"
                value={transformerQuantization}
                defaults={defaults}
                onFieldChange={onFieldChange}
              />
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
              <FieldTitle
                field="textEncoderQuantization"
                label="Text Encoder Quantization"
                value={textEncoderQuantization}
                defaults={defaults}
                onFieldChange={onFieldChange}
              />
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
            <FieldTitle
              field="resolution"
              label="Training Resolutions"
              value={resolution}
              defaults={defaults}
              onFieldChange={onFieldChange}
            />
            <div
              className={`flex flex-wrap gap-1.5 ${
                nativeActive ? 'pointer-events-none opacity-40' : ''
              }`}
            >
              {availableResolutions.map((res) => {
                const isActive = resolution.includes(res);
                return (
                  <button
                    key={res}
                    type="button"
                    disabled={nativeActive}
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
            <p className="mt-1 text-sm text-slate-400">
              {nativeActive
                ? 'Overridden by the native resolution below'
                : isKohya
                  ? 'Trains at the largest size; selecting several enables aspect-ratio bucketing across the range'
                  : 'Each selected size is trained; multiple sizes improve flexibility at different render resolutions'}
            </p>
          </div>
        )}

        {/* Native resolution (Kohya-only). Read-only text in Simple mode, and
            hidden there entirely when unset — nothing worth saying about an
            override that isn't in play. Interactive from Intermediate up. */}
        {visibleFields.has('nativeResolution' satisfies keyof FormState) &&
          !(isSimple && !nativeActive) && (
            <div>
              <FieldTitle
                field="nativeResolution"
                label="Native Resolution"
                value={nativeResolution}
                defaults={defaults}
                onFieldChange={onFieldChange}
              />
              {isSimple ? (
                <p className="text-sm font-medium tabular-nums">
                  {native ? (
                    <>
                      {native.width}&times;{native.height}
                      <span className="ml-2 font-normal text-slate-400">
                        exact size, no bucketing
                      </span>
                    </>
                  ) : (
                    <span className="text-amber-500">
                      {nativeResolution.trim()} &mdash; {nativeError}
                    </span>
                  )}
                </p>
              ) : (
                <>
                  <Input
                    type="text"
                    value={nativeResolution}
                    onChange={(e) =>
                      onFieldChange('nativeResolution', e.target.value)
                    }
                    placeholder="e.g. 1280x768"
                    className="w-32"
                    aria-label="Native resolution"
                    aria-invalid={nativeError !== null}
                  />
                  <p className="mt-1 text-sm text-slate-400">
                    Trains at this exact size with no bucketing, resizing or
                    cropping. Images must already be this size. Leave blank to
                    use the resolutions above.
                  </p>
                  {nativeError && (
                    <p className="mt-1 text-sm text-amber-500">{nativeError}</p>
                  )}
                </>
              )}
            </div>
          )}

        {/* Gradient Accumulation + Bucket Resolution Steps */}
        {(visibleFields.has(
          'gradientAccumulationSteps' satisfies keyof FormState,
        ) ||
          visibleFields.has('bucketResoSteps' satisfies keyof FormState) ||
          visibleFields.has('blocksToSwap' satisfies keyof FormState)) && (
          <div className="grid grid-cols-4 gap-x-4 gap-y-3">
            {visibleFields.has(
              'gradientAccumulationSteps' satisfies keyof FormState,
            ) && (
              <div>
                <FieldTitle
                  field="gradientAccumulationSteps"
                  label="Gradient Accumulation Steps"
                  value={gradientAccumulationSteps}
                  defaults={defaults}
                  onFieldChange={onFieldChange}
                />
                <Input
                  type="number"
                  min={1}
                  max={16}
                  value={gradientAccumulationSteps}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (val > 0)
                      onFieldChange('gradientAccumulationSteps', val);
                  }}
                  className="w-24"
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
            )}

            {visibleFields.has('bucketResoSteps' satisfies keyof FormState) && (
              <div>
                <FieldTitle
                  field="bucketResoSteps"
                  label="Bucket Resolution Steps"
                  value={bucketResoSteps}
                  defaults={defaults}
                  onFieldChange={onFieldChange}
                />
                <Input
                  type="number"
                  min={1}
                  value={bucketResoSteps}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (val > 0) onFieldChange('bucketResoSteps', val);
                  }}
                  placeholder="64"
                  className="w-24"
                />
                <p className="mt-1 text-xs text-slate-400">
                  Bucket size increment for multi-resolution training
                </p>
              </div>
            )}

            {visibleFields.has('blocksToSwap' satisfies keyof FormState) && (
              <div>
                <FieldTitle
                  field="blocksToSwap"
                  label="Blocks to Swap"
                  value={blocksToSwap}
                  defaults={defaults}
                  onFieldChange={onFieldChange}
                />
                <Input
                  type="number"
                  min={0}
                  value={blocksToSwap}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val) && val >= 0)
                      onFieldChange('blocksToSwap', val);
                  }}
                  placeholder="0"
                  className="w-24"
                />
                <p className="mt-1 text-xs text-slate-400">
                  Offloads N transformer blocks to CPU to cut VRAM; slows
                  training.
                </p>
              </div>
            )}
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

          {visibleFields.has('bucketNoUpscale' satisfies keyof FormState) && (
            <div className="flex items-center gap-2">
              <Checkbox
                isSelected={bucketNoUpscale}
                onChange={() =>
                  onFieldChange('bucketNoUpscale', !bucketNoUpscale)
                }
                label="No Bucket Upscale"
                size="sm"
              />
              <span className="text-xs text-slate-400">
                Don&apos;t upscale small images to fit a bucket
              </span>
            </div>
          )}

          {visibleFields.has('lowVram' satisfies keyof FormState) && (
            <div className="flex items-center gap-2">
              <Checkbox
                isSelected={lowVram}
                onChange={() => onFieldChange('lowVram', !lowVram)}
                label="Low VRAM"
                size="sm"
              />
              <span className="text-xs text-slate-400">
                Offload model components to cut VRAM at the cost of speed
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
