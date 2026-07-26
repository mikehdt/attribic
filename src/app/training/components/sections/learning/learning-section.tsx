import { memo, useCallback, useMemo } from 'react';

import type { TrainingFieldName } from '@/app/services/training/field-registry';
import {
  ADAPTIVE_OPTIMIZERS,
  OPTIMIZER_OPTIONS,
  SCHEDULER_OPTIONS,
  type TrainingDefaults,
} from '@/app/services/training/models';
import { Checkbox } from '@/app/shared/checkbox';
import { CollapsibleSection } from '@/app/shared/collapsible-section';
import { Dropdown, type DropdownItem } from '@/app/shared/dropdown';
import { FormTitle } from '@/app/shared/form-title/form-title';
import { Input } from '@/app/shared/input/input';
import { InputTray } from '@/app/shared/input-tray/input-tray';
import { SegmentedControl } from '@/app/shared/segmented-control/segmented-control';
import { Slider } from '@/app/shared/slider/slider';
import type { TrainingViewMode } from '@/app/store/preferences';

import { FieldTitle } from '../../field-title';
import { NumberField } from '../../number-field';
import { SchedulerSparkline } from '../../scheduler-sparkline';
import type {
  DurationMode,
  FormState,
  SectionName,
} from '../../training-config-form/use-training-config-form';
import { SectionHeaderExtra } from '../section-header-extra';
import { SectionResetButton } from '../section-reset-button';
import { getLrLabel, lrToSlider, sliderToLr } from './lr-slider-utils';

type LearningSectionProps = {
  durationMode: DurationMode;
  epochs: number;
  steps: number;
  learningRate: number;
  optimizer: string;
  scheduler: string;
  warmupSteps: number;
  numRestarts: number;
  weightDecay: number;
  maxGradNorm: number;
  seed: number;
  trainTextEncoder: boolean;
  backboneLR: number;
  textEncoderLR: number;
  ema: boolean;
  emaDecay: number;
  lossType: 'mse' | 'huber' | 'smooth_l1';
  timestepType: string;
  timestepBias: 'balanced' | 'earlier' | 'later';
  discreteFlowShift: number;
  minSnrGamma: number;
  noiseOffset: number;
  optimizerArgs: string;
  contentOrStyle: 'balanced' | 'content' | 'style';
  diffOutputPreservation: boolean;
  diffOutputPreservationMultiplier: number;
  diffOutputPreservationClass: string;
  cacheTextEmbeddings: boolean;
  calculatedSteps: number;
  calculatedEpochs: number;
  totalEffective: number;
  batchSize: number;
  /** Display name of the currently selected model, for the epoch-guidance hint. */
  modelName: string;
  hasChanges: boolean;
  defaults: TrainingDefaults;
  visibleFields: Set<TrainingFieldName>;
  hiddenChangesCount?: number;
  viewMode: TrainingViewMode;
  onFieldChange: <K extends keyof FormState>(
    field: K,
    value: FormState[K],
  ) => void;
  onOptimizerChange: (value: string) => void;
  onReset: (section: SectionName) => void;
};

const LOSS_TYPE_ITEMS: DropdownItem<string>[] = [
  { value: 'mse', label: 'Mean Squared Error (default)' },
  { value: 'huber', label: 'Huber (outlier-robust)' },
  { value: 'smooth_l1', label: 'Smooth L1' },
];

const TIMESTEP_TYPE_ITEMS: DropdownItem<string>[] = [
  { value: 'sigmoid', label: 'Sigmoid' },
  { value: 'linear', label: 'Linear' },
  { value: 'shift', label: 'Shift' },
  { value: 'weighted', label: 'Weighted' },
];

const TIMESTEP_BIAS_ITEMS: DropdownItem<string>[] = [
  { value: 'balanced', label: 'Balanced' },
  { value: 'earlier', label: 'Earlier (coarse structure)' },
  { value: 'later', label: 'Later (fine details)' },
];

const CONTENT_OR_STYLE_ITEMS: DropdownItem<string>[] = [
  { value: 'balanced', label: 'Balanced' },
  { value: 'content', label: 'Content (subject)' },
  { value: 'style', label: 'Style' },
];

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

const LearningSectionComponent = ({
  durationMode,
  epochs,
  steps,
  learningRate,
  optimizer,
  scheduler,
  warmupSteps,
  numRestarts,
  weightDecay,
  maxGradNorm,
  seed,
  trainTextEncoder,
  backboneLR,
  textEncoderLR,
  ema,
  emaDecay,
  lossType,
  timestepType,
  timestepBias,
  discreteFlowShift,
  minSnrGamma,
  noiseOffset,
  optimizerArgs,
  contentOrStyle,
  diffOutputPreservation,
  diffOutputPreservationMultiplier,
  diffOutputPreservationClass,
  cacheTextEmbeddings,
  calculatedSteps,
  calculatedEpochs,
  totalEffective,
  batchSize,
  modelName,
  hasChanges,
  defaults,
  visibleFields,
  hiddenChangesCount,
  viewMode,
  onFieldChange,
  onOptimizerChange,
  onReset,
}: LearningSectionProps) => {
  const isSimple = viewMode === 'simple';

  const optimizerItems = useMemo(() => {
    return OPTIMIZER_OPTIONS.map((group) => ({
      groupLabel: group.group,
      items: group.items.map(
        (opt) =>
          ({
            value: opt.value,
            label: (
              <div className="flex flex-col">
                <span>{opt.label}</span>
                <span className="text-xs text-slate-400">{opt.hint}</span>
              </div>
            ),
          }) satisfies DropdownItem<string>,
      ),
    }));
  }, []);

  const selectedOptimizer = OPTIMIZER_OPTIONS.flatMap((g) => g.items).find(
    (o) => o.value === optimizer,
  );
  const isAdaptiveOptimizer = ADAPTIVE_OPTIMIZERS.has(optimizer);

  const selectedScheduler = SCHEDULER_OPTIONS.find(
    (s) => s.value === scheduler,
  );

  const schedulerItems = useMemo(() => {
    return SCHEDULER_OPTIONS.map(
      (sched) =>
        ({
          value: sched.value,
          label: (
            <div className="flex items-center gap-2">
              <SchedulerSparkline
                curve={sched.curve}
                className="text-sky-500"
              />
              <div className="flex flex-col">
                <span>{sched.label}</span>
                <span className="text-xs text-slate-400">{sched.hint}</span>
              </div>
            </div>
          ),
        }) satisfies DropdownItem<string>,
    );
  }, []);

  const showDuration =
    visibleFields.has('durationMode') ||
    visibleFields.has('epochs') ||
    visibleFields.has('steps');

  const sliderPosition = lrToSlider(learningRate);
  const lrLabel = getLrLabel(learningRate);

  const handleLrSlider = useCallback(
    (pos: number) => {
      onFieldChange('learningRate', sliderToLr(pos));
    },
    [onFieldChange],
  );

  const handleLrTextChange = useCallback(
    (raw: string) => {
      const parsed = parseFloat(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) return;
      onFieldChange('learningRate', parsed);
    },
    [onFieldChange],
  );

  const handleOptimizerReset = useCallback(
    (_field: 'optimizer', value: string) => {
      onOptimizerChange(value);
    },
    [onOptimizerChange],
  );

  // Epoch guidance derived from dataset size: recommend how many epochs it
  // takes to land near the model's community-consensus target step count.
  const recommendedEpochs =
    totalEffective > 0
      ? clamp(Math.round((defaults.steps * batchSize) / totalEffective), 1, 999)
      : 0;
  const epochsDivergent =
    durationMode === 'epochs' &&
    totalEffective > 0 &&
    epochs > 0 &&
    (recommendedEpochs > epochs * 2 || epochs > recommendedEpochs * 2);

  // Non-blocking shape check for the raw optimizer_args editor: each
  // whitespace-separated chunk should look like key=value.
  const optimizerArgsInvalid =
    optimizerArgs.trim() !== '' &&
    optimizerArgs
      .trim()
      .split(/\s+/)
      .some((chunk) => !/^[^=\s]+=[^=\s]*$/.test(chunk));

  return (
    <CollapsibleSection
      title="Learning"
      headerExtra={
        <SectionHeaderExtra
          hasChanges={hasChanges}
          hiddenChangesCount={hiddenChangesCount}
        />
      }
      headerActions={(expanded) =>
        hasChanges && expanded ? (
          <SectionResetButton onClick={() => onReset('learning')} />
        ) : undefined
      }
    >
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2 md:items-start">
        {/* Left column: primary controls — Duration, LR, Optimiser, Scheduler */}
        <div className="space-y-3">
          {showDuration && (
            <div>
              <FormTitle>Duration</FormTitle>

              <InputTray size="md" gap="sm">
                <Input
                  type="number"
                  min={1}
                  value={durationMode === 'epochs' ? epochs : steps}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (val > 0) {
                      onFieldChange(
                        durationMode === 'epochs' ? 'epochs' : 'steps',
                        val,
                      );
                    }
                  }}
                  className="w-32"
                  size="md"
                />

                <SegmentedControl
                  options={[
                    { value: 'epochs', label: 'Epochs' },
                    { value: 'steps', label: 'Steps' },
                  ]}
                  value={durationMode}
                  onChange={(val) => onFieldChange('durationMode', val)}
                  size="md"
                />
              </InputTray>

              {totalEffective > 0 && (
                <p className="mt-1 text-xs text-slate-400 tabular-nums">
                  {totalEffective} images/epoch &times;{' '}
                  {durationMode === 'epochs'
                    ? `${epochs}`
                    : `${calculatedEpochs}`}{' '}
                  epochs &divide; {batchSize} batch ={' '}
                  <span className="font-medium text-slate-500">
                    {durationMode === 'epochs'
                      ? calculatedSteps.toLocaleString()
                      : steps.toLocaleString()}{' '}
                    steps
                  </span>
                </p>
              )}

              {totalEffective > 0 &&
                (durationMode === 'epochs' ? (
                  <p
                    className={`mt-1 text-xs tabular-nums ${
                      epochsDivergent ? 'text-amber-500' : 'text-slate-400'
                    }`}
                  >
                    &asymp;{recommendedEpochs} epochs suits this dataset
                    (targets ~{defaults.steps.toLocaleString()} steps for{' '}
                    {modelName})
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-slate-400 tabular-nums">
                    Model guideline: ~{defaults.steps.toLocaleString()} steps
                  </p>
                ))}
            </div>
          )}

          {/* Learning Rate — slider + editable numeric box in every tier */}
          {visibleFields.has('learningRate') && (
            <div>
              <FieldTitle
                field="learningRate"
                label="Learning Rate"
                value={learningRate}
                defaults={defaults}
                onFieldChange={onFieldChange}
              />
              <Slider
                min={0}
                max={100}
                step={1}
                value={Math.round(sliderPosition)}
                onChange={handleLrSlider}
                showTrackFill
                startLabel={isSimple ? 'Slower' : undefined}
                midLabel={isSimple ? lrLabel : undefined}
                endLabel={isSimple ? 'Faster' : undefined}
                valueDisplay={learningRate}
                numberInputSize="md"
                onValueDisplayChange={handleLrTextChange}
                ariaLabel="Learning rate"
              />
            </div>
          )}

          {/* Optimizer — read-only in Simple, dropdown in Intermediate+ */}
          {visibleFields.has('optimizer') && (
            <div>
              <FieldTitle
                field="optimizer"
                label="Optimiser"
                value={optimizer}
                defaults={defaults}
                onFieldChange={handleOptimizerReset}
              />
              {isSimple ? (
                <p className="text-sm text-(--foreground)/80">
                  {selectedOptimizer?.label ?? optimizer}
                  {selectedOptimizer && (
                    <span className="ml-1 text-xs text-slate-400">
                      — {selectedOptimizer.hint}
                    </span>
                  )}
                </p>
              ) : (
                <>
                  <Dropdown
                    items={optimizerItems}
                    selectedValue={optimizer}
                    onChange={onOptimizerChange}
                    selectedValueRenderer={() => (
                      <span className="text-sm">
                        {selectedOptimizer?.label ?? optimizer}
                      </span>
                    )}
                    aria-label="Select optimizer"
                  />
                  {selectedOptimizer && (
                    <p className="mt-1 text-xs text-slate-400">
                      {selectedOptimizer.hint}
                    </p>
                  )}
                  {isAdaptiveOptimizer && (
                    <p className="mt-1 text-xs text-amber-500/70">
                      Adaptive optimiser — learning rate should stay near 1.0.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Scheduler — read-only in Simple, dropdown in Intermediate+ */}
          {visibleFields.has('scheduler') && (
            <div>
              <FieldTitle
                field="scheduler"
                label="LR Scheduler"
                value={scheduler}
                defaults={defaults}
                onFieldChange={onFieldChange}
              />
              {isSimple ? (
                <div className="flex items-center gap-2 text-sm text-(--foreground)/80">
                  {selectedScheduler && (
                    <SchedulerSparkline
                      curve={selectedScheduler.curve}
                      className="text-sky-500"
                    />
                  )}
                  <span>{selectedScheduler?.label ?? scheduler}</span>
                  {selectedScheduler && (
                    <span className="text-xs text-slate-400">
                      — {selectedScheduler.hint}
                    </span>
                  )}
                </div>
              ) : (
                <>
                  <Dropdown
                    items={schedulerItems}
                    selectedValue={scheduler}
                    onChange={(val) => onFieldChange('scheduler', val)}
                    selectedValueRenderer={() => (
                      <div className="flex items-center gap-2">
                        {selectedScheduler && (
                          <SchedulerSparkline
                            curve={selectedScheduler.curve}
                            className="text-sky-500"
                          />
                        )}
                        <span className="text-sm">
                          {selectedScheduler?.label ?? scheduler}
                        </span>
                      </div>
                    )}
                    aria-label="LR scheduler"
                  />
                  {selectedScheduler && (
                    <p className="mt-1 text-xs text-slate-400">
                      {selectedScheduler.hint}
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Warmup + Restarts row */}
          {(visibleFields.has('warmupSteps') ||
            visibleFields.has('numRestarts')) && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {visibleFields.has('warmupSteps') && (
                <NumberField
                  field="warmupSteps"
                  label="Warmup Steps"
                  value={warmupSteps}
                  defaults={defaults}
                  onFieldChange={onFieldChange}
                  kind="int"
                  min={0}
                  placeholder={String(defaults.warmupSteps)}
                  className="w-24"
                />
              )}

              {visibleFields.has('numRestarts') && (
                <NumberField
                  field="numRestarts"
                  label="Restarts"
                  value={numRestarts}
                  defaults={defaults}
                  onFieldChange={onFieldChange}
                  kind="int"
                  min={1}
                  placeholder={String(defaults.numRestarts)}
                  className="w-24"
                  hint="Cosine cycles"
                />
              )}
            </div>
          )}
        </div>

        {/* Right column: compact scalars + advanced/expert extras */}
        <div className="space-y-3">
          {(visibleFields.has('batchSize') ||
            visibleFields.has('seed') ||
            visibleFields.has('weightDecay') ||
            visibleFields.has('maxGradNorm')) && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {visibleFields.has('batchSize') && (
                <NumberField
                  field="batchSize"
                  label="Batch Size"
                  value={batchSize}
                  defaults={defaults}
                  onFieldChange={onFieldChange}
                  kind="int"
                  min={1}
                  max={8}
                  className="w-full tabular-nums"
                  hint={
                    batchSize > 1 ? (
                      <span className="text-amber-500">
                        Higher batch sizes use significantly more VRAM
                      </span>
                    ) : undefined
                  }
                />
              )}

              {visibleFields.has('seed') && (
                <NumberField
                  field="seed"
                  label="Seed"
                  value={seed}
                  defaults={defaults}
                  onFieldChange={onFieldChange}
                  kind="int"
                  min={-1}
                  className="w-full tabular-nums"
                  hint="-1 for random, fixed for reproducibility. Seeds the training run, not sample generation."
                />
              )}

              {visibleFields.has('weightDecay') && (
                <NumberField
                  field="weightDecay"
                  label="Weight Decay"
                  value={weightDecay}
                  defaults={defaults}
                  onFieldChange={onFieldChange}
                  min={0}
                  placeholder={String(defaults.weightDecay)}
                  hint="L2 regularisation (0 = disabled)"
                />
              )}

              {visibleFields.has('maxGradNorm') && (
                <NumberField
                  field="maxGradNorm"
                  label="Max Gradient Norm"
                  value={maxGradNorm}
                  defaults={defaults}
                  onFieldChange={onFieldChange}
                  min={0}
                  placeholder={String(defaults.maxGradNorm)}
                  hint="Clip gradients (0 = disabled, 1.0 standard)"
                />
              )}
            </div>
          )}

          {/* Train Text Encoder checkbox */}
          {visibleFields.has('trainTextEncoder') && (
            <div className="flex items-center gap-2">
              <Checkbox
                isSelected={trainTextEncoder}
                onChange={() =>
                  onFieldChange('trainTextEncoder', !trainTextEncoder)
                }
                label="Train Text Encoder"
                size="sm"
              />
              <span className="text-xs text-slate-400">
                Also train the text encoder alongside the backbone
              </span>
            </div>
          )}

          {/* Backbone LR + Text Encoder LR row */}
          {(visibleFields.has('backboneLR') ||
            visibleFields.has('textEncoderLR')) && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {visibleFields.has('backboneLR') && (
                <NumberField
                  field="backboneLR"
                  label="Backbone LR"
                  value={backboneLR}
                  defaults={defaults}
                  onFieldChange={onFieldChange}
                  min={0}
                  placeholder={String(defaults.backboneLR)}
                  hint="0 = use main LR"
                />
              )}

              {visibleFields.has('textEncoderLR') && (
                <NumberField
                  field="textEncoderLR"
                  label="Text Encoder LR"
                  value={textEncoderLR}
                  defaults={defaults}
                  onFieldChange={onFieldChange}
                  min={0}
                  placeholder={String(defaults.textEncoderLR)}
                  hint="0 = use main LR"
                />
              )}
            </div>
          )}

          {visibleFields.has('ema') && (
            <div className="flex items-center gap-2">
              <Checkbox
                isSelected={ema}
                onChange={() => onFieldChange('ema', !ema)}
                label="Use EMA"
                size="sm"
              />
              <span className="text-xs text-slate-400">
                Exponential moving average of weights — can improve stability
              </span>
            </div>
          )}

          {visibleFields.has('emaDecay') && (
            <NumberField
              field="emaDecay"
              label="EMA Decay"
              value={emaDecay}
              defaults={defaults}
              onFieldChange={onFieldChange}
              validate={(v) => v > 0 && v < 1}
              placeholder={String(defaults.emaDecay)}
              className="w-32 tabular-nums"
              hint="Higher = slower-moving average (0.99 typical)"
            />
          )}

          {/* Loss + Timestep row */}
          {(visibleFields.has('lossType') ||
            visibleFields.has('timestepType') ||
            visibleFields.has('timestepBias') ||
            visibleFields.has('discreteFlowShift')) && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {visibleFields.has('lossType') && (
                <div>
                  <FieldTitle
                    field="lossType"
                    label="Loss Type"
                    value={lossType}
                    defaults={defaults}
                    onFieldChange={onFieldChange}
                  />
                  <Dropdown
                    items={LOSS_TYPE_ITEMS}
                    selectedValue={lossType}
                    onChange={(val) =>
                      onFieldChange('lossType', val as FormState['lossType'])
                    }
                    aria-label="Loss type"
                  />
                </div>
              )}

              {visibleFields.has('timestepType') && (
                <div>
                  <FieldTitle
                    field="timestepType"
                    label="Timestep Type"
                    value={timestepType}
                    defaults={defaults}
                    onFieldChange={onFieldChange}
                  />
                  <Dropdown
                    items={TIMESTEP_TYPE_ITEMS}
                    selectedValue={timestepType}
                    onChange={(val) => onFieldChange('timestepType', val)}
                    aria-label="Timestep type"
                  />
                </div>
              )}

              {visibleFields.has('timestepBias') && (
                <div>
                  <FieldTitle
                    field="timestepBias"
                    label="Timestep Bias"
                    value={timestepBias}
                    defaults={defaults}
                    onFieldChange={onFieldChange}
                  />
                  <Dropdown
                    items={TIMESTEP_BIAS_ITEMS}
                    selectedValue={timestepBias}
                    onChange={(val) =>
                      onFieldChange(
                        'timestepBias',
                        val as FormState['timestepBias'],
                      )
                    }
                    aria-label="Timestep bias"
                  />
                </div>
              )}

              {visibleFields.has('discreteFlowShift') && (
                <NumberField
                  field="discreteFlowShift"
                  label="Flow Shift"
                  value={discreteFlowShift}
                  defaults={defaults}
                  onFieldChange={onFieldChange}
                  validate={(v) => v > 0}
                  placeholder={String(defaults.discreteFlowShift)}
                  hint="Flow-matching shift; higher biases training toward noisier timesteps."
                />
              )}
            </div>
          )}

          {/* Min-SNR + Noise Offset row (DDPM loss-shaping controls) */}
          {(visibleFields.has('minSnrGamma') ||
            visibleFields.has('noiseOffset')) && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {visibleFields.has('minSnrGamma') && (
                <NumberField
                  field="minSnrGamma"
                  label="Min-SNR Gamma"
                  value={minSnrGamma}
                  defaults={defaults}
                  onFieldChange={onFieldChange}
                  min={0}
                  placeholder={String(defaults.minSnrGamma)}
                  hint="Loss weighting; 5 recommended when enabled (0 = disabled)"
                />
              )}

              {visibleFields.has('noiseOffset') && (
                <NumberField
                  field="noiseOffset"
                  label="Noise Offset"
                  value={noiseOffset}
                  defaults={defaults}
                  onFieldChange={onFieldChange}
                  min={0}
                  placeholder={String(defaults.noiseOffset)}
                  hint="0 = disabled"
                />
              )}
            </div>
          )}

          {/* Content vs style bias */}
          {visibleFields.has('contentOrStyle') && (
            <div>
              <FieldTitle
                field="contentOrStyle"
                label="Content or Style"
                value={contentOrStyle}
                defaults={defaults}
                onFieldChange={onFieldChange}
              />
              <Dropdown
                items={CONTENT_OR_STYLE_ITEMS}
                selectedValue={contentOrStyle}
                onChange={(val) =>
                  onFieldChange(
                    'contentOrStyle',
                    val as FormState['contentOrStyle'],
                  )
                }
                aria-label="Content or style"
              />
              <p className="mt-1 text-xs text-slate-400">
                Bias timestep weighting toward subject content or overall style
              </p>
            </div>
          )}

          {/* Differential output preservation */}
          {visibleFields.has('diffOutputPreservation') && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  isSelected={diffOutputPreservation}
                  onChange={() =>
                    onFieldChange(
                      'diffOutputPreservation',
                      !diffOutputPreservation,
                    )
                  }
                  label="Differential Output Preservation"
                  size="sm"
                />
                <span className="text-xs text-slate-400">
                  Preserves the base model&apos;s knowledge of a class word
                </span>
              </div>

              {diffOutputPreservation && cacheTextEmbeddings && (
                <p className="text-sm text-amber-500/70">
                  Incompatible with Cache Text Embeddings (Performance) — the
                  trainer will refuse to start while both are enabled.
                </p>
              )}

              {(visibleFields.has('diffOutputPreservationMultiplier') ||
                visibleFields.has('diffOutputPreservationClass')) && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  {visibleFields.has('diffOutputPreservationMultiplier') && (
                    <NumberField
                      field="diffOutputPreservationMultiplier"
                      label="DOP Multiplier"
                      value={diffOutputPreservationMultiplier}
                      defaults={defaults}
                      onFieldChange={onFieldChange}
                      min={0}
                      placeholder={String(
                        defaults.diffOutputPreservationMultiplier,
                      )}
                    />
                  )}

                  {visibleFields.has('diffOutputPreservationClass') && (
                    <div>
                      <FieldTitle
                        field="diffOutputPreservationClass"
                        label="DOP Class"
                        value={diffOutputPreservationClass}
                        defaults={defaults}
                        onFieldChange={onFieldChange}
                      />
                      <Input
                        type="text"
                        value={diffOutputPreservationClass}
                        onChange={(e) =>
                          onFieldChange(
                            'diffOutputPreservationClass',
                            e.target.value,
                          )
                        }
                        placeholder="e.g. woman"
                        className="w-full"
                      />
                      <p className="mt-1 text-xs text-slate-400">
                        Class word the LoRA should preserve (e.g. woman).
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Raw optimizer args */}
          {visibleFields.has('optimizerArgs') && (
            <div>
              <FieldTitle
                field="optimizerArgs"
                label="Optimizer Args"
                value={optimizerArgs}
                defaults={defaults}
                onFieldChange={onFieldChange}
              />
              <Input
                type="text"
                value={optimizerArgs}
                onChange={(e) => onFieldChange('optimizerArgs', e.target.value)}
                placeholder="weight_decay=0.01 betas=0.9,0.99"
                className="w-full"
              />
              <p className="mt-1 text-xs text-slate-400">
                Raw optimizer_args key=value pairs, space-separated. Overrides
                the Weight Decay field if you set weight_decay here.
              </p>
              {optimizerArgsInvalid && (
                <p className="mt-1 text-xs text-amber-500/70">
                  Each entry should be key=value; malformed entries are ignored.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </CollapsibleSection>
  );
};

export const LearningSection = memo(LearningSectionComponent);
