import { memo, useCallback } from 'react';

import type { TrainingFieldName } from '@/app/services/training/field-registry';
import type { TrainingDefaults } from '@/app/services/training/models';
import { parseNativeResolution } from '@/app/services/training/native-resolution';
import { hasCapability } from '@/app/services/training/provider-capabilities';
import type { TrainingProvider } from '@/app/services/training/types';
import { Button } from '@/app/shared/button';
import { Checkbox } from '@/app/shared/checkbox';
import { CollapsibleSection } from '@/app/shared/collapsible-section';
import { Dropdown, type DropdownItem } from '@/app/shared/dropdown';
import { Input } from '@/app/shared/input/input';
import { RadioGroup } from '@/app/shared/radio-group';
import type { TrainingViewMode } from '@/app/store/preferences';

import { FieldTitle } from '../field-title';
import { NumberField } from '../number-field';
import type {
  FormState,
  SectionName,
} from '../training-config-form/use-training-config-form';
import { SectionHeaderExtra } from './section-header-extra';
import { SectionResetButton } from './section-reset-button';
import { type ResolutionMode, useResolutionMode } from './use-resolution-mode';

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
  layerOffloadPercent: number;
  hasChanges: boolean;
  defaults: TrainingDefaults;
  visibleFields: Set<TrainingFieldName>;
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

const RESOLUTION_MODE_OPTIONS: { value: ResolutionMode; label: string }[] = [
  { value: 'bucketed', label: 'Training resolutions' },
  { value: 'native', label: 'Exact resolution' },
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
  layerOffloadPercent,
  hasChanges,
  defaults,
  visibleFields,
  hiddenChangesCount,
  onFieldChange,
  onReset,
}: PerformanceSectionProps) => {
  const hasBucketControls = hasCapability(provider, 'bucketControls');

  // Hooks before the early return below.
  const handleNativeChange = useCallback(
    (value: string) => onFieldChange('nativeResolution', value),
    [onFieldChange],
  );
  const { mode, selectMode, setNativeResolution } = useResolutionMode(
    nativeResolution,
    handleNativeChange,
  );

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
    visibleFields.has('layerOffloadPercent') ||
    visibleFields.has('lowVram');

  if (!hasVisibleFields) return null;

  // An exact WxH size takes precedence over the resolution list (see the
  // sidecar's Kohya provider, which drops bucketing entirely when it's set).
  // Validate here so a typo surfaces in the form rather than failing the job.
  const isSimple = viewMode === 'simple';
  const nativeActive = nativeResolution.trim().length > 0;
  const { value: native, error: nativeError } =
    parseNativeResolution(nativeResolution);

  // The two are mutually exclusive rather than independent, so where both are
  // editable they're presented as one radio choice and only the chosen
  // control is shown. Simple mode keeps the old side-by-side layout: the
  // exact size is read-only there, so there'd be no choice to make.
  const showModeChoice =
    !isSimple &&
    visibleFields.has('resolution') &&
    visibleFields.has('nativeResolution');
  const showResolutions =
    visibleFields.has('resolution') && (!showModeChoice || mode === 'bucketed');
  const showNative =
    visibleFields.has('nativeResolution') &&
    (showModeChoice ? mode === 'native' : !(isSimple && !nativeActive));

  // Seed for the native option so picking it lands on a valid, obvious size
  // rather than an empty box: the largest selected size, squared.
  const handleModeChange = (next: ResolutionMode) => {
    const largest = resolution.length > 0 ? Math.max(...resolution) : 1024;
    selectMode(next, `${largest}x${largest}`);
  };

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
        <SectionHeaderExtra
          hasChanges={hasChanges}
          hiddenChangesCount={hiddenChangesCount}
        />
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
          {visibleFields.has('mixedPrecision') && (
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

          {visibleFields.has('transformerQuantization') && (
            <div>
              <FieldTitle
                field="transformerQuantization"
                label="Transformer Quantisation"
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
                aria-label="Transformer quantisation"
              />
              <p className="mt-1 text-xs text-slate-400">
                Quantise weights to save VRAM
              </p>
            </div>
          )}

          {visibleFields.has('textEncoderQuantization') && (
            <div>
              <FieldTitle
                field="textEncoderQuantization"
                label="Text Encoder Quantisation"
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
                aria-label="Text encoder quantisation"
              />
              <p className="mt-1 text-xs text-slate-400">
                T5, CLIP or Qwen encoders
              </p>
            </div>
          )}
        </div>

        {/* Resolution: a list of sizes to bucket across, or one exact native
            size — never both. Exact resolution is Kohya-only, and read-only
            text in Simple mode (hidden there entirely when unset, since
            there's nothing worth saying about an override that isn't in
            play). */}
        {(showResolutions || showNative) && (
          <div className="space-y-3">
            {showModeChoice && (
              <div>
                {mode === 'native' ? (
                  <FieldTitle
                    field="nativeResolution"
                    label="Resolution"
                    value={nativeResolution}
                    defaults={defaults}
                    onFieldChange={onFieldChange}
                  />
                ) : (
                  <FieldTitle
                    field="resolution"
                    label="Resolution"
                    value={resolution}
                    defaults={defaults}
                    onFieldChange={onFieldChange}
                  />
                )}
                <RadioGroup
                  name="Resolution mode"
                  options={RESOLUTION_MODE_OPTIONS}
                  value={mode}
                  onChange={handleModeChange}
                  size="sm"
                />
              </div>
            )}

            {showResolutions && (
              <div>
                {!showModeChoice && (
                  <FieldTitle
                    field="resolution"
                    label="Training Resolutions"
                    value={resolution}
                    defaults={defaults}
                    onFieldChange={onFieldChange}
                  />
                )}
                <div
                  className={`flex flex-wrap gap-x-1.5 ${
                    nativeActive ? 'pointer-events-none opacity-40' : ''
                  }`}
                >
                  {availableResolutions.map((res) => {
                    const isActive = resolution.includes(res);
                    return (
                      <Button
                        key={res}
                        variant="toggle"
                        color="sky"
                        neutralUnpressed
                        size="sm"
                        width="lg"
                        disabled={nativeActive}
                        onClick={() => handleToggleResolution(res)}
                        isPressed={isActive}
                      >
                        {res}
                      </Button>
                    );
                  })}
                </div>
                <p className="mt-1 text-sm text-slate-400">
                  {nativeActive
                    ? 'Overridden by the Exact resolution below'
                    : hasBucketControls
                      ? 'Trains at the largest size; selecting several enables aspect-ratio bucketing across the range'
                      : 'Each selected size is trained; multiple sizes improve flexibility at different render resolutions'}
                </p>
              </div>
            )}

            {showNative && (
              <div>
                {!showModeChoice && (
                  <FieldTitle
                    field="nativeResolution"
                    label="Single Resolution"
                    value={nativeResolution}
                    defaults={defaults}
                    onFieldChange={onFieldChange}
                  />
                )}
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
                      onChange={(e) => setNativeResolution(e.target.value)}
                      placeholder="e.g. 1280x768"
                      className="w-32"
                      size="sm"
                      aria-label="Single resolution"
                      aria-invalid={nativeError !== null}
                    />
                    <p className="mt-1 text-sm text-slate-400">
                      Trains at this exact size with no bucketing, resizing or
                      cropping. Images must already be this size.
                      {!showModeChoice &&
                        ' Leave blank to use the resolutions above.'}
                    </p>
                    {nativeError && (
                      <p className="mt-1 text-sm text-amber-500">
                        {nativeError}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Gradient Accumulation + Bucket Resolution Steps */}
        {(visibleFields.has('gradientAccumulationSteps') ||
          visibleFields.has('bucketResoSteps') ||
          visibleFields.has('blocksToSwap') ||
          visibleFields.has('layerOffloadPercent')) && (
          <div className="grid grid-cols-4 gap-x-4 gap-y-3">
            {visibleFields.has('gradientAccumulationSteps') && (
              <NumberField
                field="gradientAccumulationSteps"
                label="Gradient Accumulation Steps"
                value={gradientAccumulationSteps}
                defaults={defaults}
                onFieldChange={onFieldChange}
                kind="int"
                min={1}
                max={16}
                className="w-24 tabular-nums"
                hint={
                  gradientAccumulationSteps > 1 ? (
                    <>
                      Effective batch size:{' '}
                      <span className="font-medium">
                        {batchSize * gradientAccumulationSteps}
                      </span>{' '}
                      ({batchSize} &times; {gradientAccumulationSteps})
                    </>
                  ) : undefined
                }
              />
            )}

            {visibleFields.has('bucketResoSteps') && (
              <NumberField
                field="bucketResoSteps"
                label="Bucket Resolution Steps"
                value={bucketResoSteps}
                defaults={defaults}
                onFieldChange={onFieldChange}
                kind="int"
                min={1}
                placeholder="64"
                className="w-24 tabular-nums"
                hint="Bucket size increment for multi-resolution training"
              />
            )}

            {visibleFields.has('blocksToSwap') && (
              <NumberField
                field="blocksToSwap"
                label="Blocks to Swap"
                value={blocksToSwap}
                defaults={defaults}
                onFieldChange={onFieldChange}
                kind="int"
                min={0}
                placeholder="0"
                className="w-24 tabular-nums"
                hint="Offloads N transformer blocks to CPU to cut VRAM; slows training."
              />
            )}

            {visibleFields.has('layerOffloadPercent') && (
              <NumberField
                field="layerOffloadPercent"
                label="Transformer Offload %"
                value={layerOffloadPercent}
                defaults={defaults}
                onFieldChange={onFieldChange}
                kind="int"
                min={0}
                max={100}
                placeholder="0"
                className="w-24 tabular-nums"
                hint="Streams this share of transformer layers from system RAM each step. 0 = off; use when the model outsizes VRAM."
              />
            )}
          </div>
        )}

        {/* Checkboxes */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {visibleFields.has('cacheTextEmbeddings') && (
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

          {visibleFields.has('unloadTextEncoder') && (
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

          {visibleFields.has('gradientCheckpointing') && (
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

          {visibleFields.has('cacheLatents') && (
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

          {visibleFields.has('bucketNoUpscale') && (
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

          {visibleFields.has('lowVram') && (
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

export const PerformanceSection = memo(PerformanceSectionComponent);
