import { memo, useCallback, useMemo } from 'react';

import {
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

import { SchedulerSparkline } from '../../scheduler-sparkline';
import type {
  DurationMode,
  FormState,
  SectionName,
} from '../../training-config-form/use-training-config-form';
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
  lossType: 'mse' | 'huber' | 'smooth_l1';
  timestepType: string;
  timestepBias: 'balanced' | 'earlier' | 'later';
  calculatedSteps: number;
  calculatedEpochs: number;
  totalEffective: number;
  batchSize: number;
  hasChanges: boolean;
  defaults: TrainingDefaults;
  visibleFields: Set<string>;
  hiddenChangesCount?: number;
  viewMode: TrainingViewMode;
  onFieldChange: <K extends keyof FormState>(
    field: K,
    value: FormState[K],
  ) => void;
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
  lossType,
  timestepType,
  timestepBias,
  calculatedSteps,
  calculatedEpochs,
  totalEffective,
  batchSize,
  hasChanges,
  defaults,
  visibleFields,
  hiddenChangesCount,
  viewMode,
  onFieldChange,
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
    visibleFields.has('durationMode' satisfies keyof FormState) ||
    visibleFields.has('epochs' satisfies keyof FormState) ||
    visibleFields.has('steps' satisfies keyof FormState);

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

  return (
    <CollapsibleSection
      title="Learning"
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
          <SectionResetButton onClick={() => onReset('learning')} />
        ) : undefined
      }
    >
      <div className="space-y-3">
        {/* Duration + Batch Size row */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
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
            </div>
          )}

          {visibleFields.has('batchSize' satisfies keyof FormState) && (
            <div>
              <FormTitle>Batch Size</FormTitle>
              <Input
                type="number"
                min={1}
                max={8}
                value={batchSize}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (val > 0) onFieldChange('batchSize', val);
                }}
                className="w-20"
              />
              {batchSize > 1 && (
                <p className="mt-1 text-xs text-amber-500">
                  Higher batch sizes use significantly more VRAM
                </p>
              )}
            </div>
          )}
        </div>

        {/* Learning Rate — full width (slider in simple, input in intermediate+) */}
        {visibleFields.has('learningRate' satisfies keyof FormState) && (
          <div>
            <FormTitle>Learning Rate</FormTitle>
            {isSimple ? (
              <Slider
                min={0}
                max={100}
                step={1}
                value={Math.round(sliderPosition)}
                onChange={handleLrSlider}
                showTrackFill
                startLabel="Slower"
                midLabel={lrLabel}
                endLabel="Faster"
                valueDisplay={learningRate}
                numberInputSize="md"
                onValueDisplayChange={handleLrTextChange}
                ariaLabel="Learning rate"
              />
            ) : (
              <Input
                type="text"
                value={learningRate}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val) && val > 0) {
                    onFieldChange('learningRate', val);
                  }
                }}
                placeholder={String(defaults.learningRate)}
                className="w-32 tabular-nums"
              />
            )}
          </div>
        )}

        {/* Optimizer — full width (read-only in Simple, dropdown in Intermediate+) */}
        {visibleFields.has('optimizer' satisfies keyof FormState) && (
          <div>
            <FormTitle>Optimiser</FormTitle>
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
                  onChange={(val) => onFieldChange('optimizer', val)}
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
              </>
            )}
          </div>
        )}

        {/* Scheduler — full width (read-only in Simple, dropdown in Intermediate+) */}
        {visibleFields.has('scheduler' satisfies keyof FormState) && (
          <div>
            <FormTitle>LR Scheduler</FormTitle>
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
        {(visibleFields.has('warmupSteps' satisfies keyof FormState) ||
          visibleFields.has('numRestarts' satisfies keyof FormState)) && (
          <div className="grid grid-cols-4 gap-x-4 gap-y-3">
            {visibleFields.has('warmupSteps' satisfies keyof FormState) && (
              <div>
                <FormTitle>Warmup Steps</FormTitle>
                <Input
                  type="number"
                  min={0}
                  value={warmupSteps}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (val >= 0) onFieldChange('warmupSteps', val);
                  }}
                  placeholder={String(defaults.warmupSteps)}
                  className="w-full"
                />
              </div>
            )}

            {visibleFields.has('numRestarts' satisfies keyof FormState) && (
              <div>
                <FormTitle>Restarts</FormTitle>
                <Input
                  type="number"
                  min={1}
                  value={numRestarts}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (val >= 1) onFieldChange('numRestarts', val);
                  }}
                  placeholder={String(defaults.numRestarts)}
                  className="w-full"
                />
                <p className="mt-1 text-xs text-slate-400">Cosine cycles</p>
              </div>
            )}
          </div>
        )}

        {/* Weight Decay + Max Grad Norm + Seed row */}
        {(visibleFields.has('weightDecay' satisfies keyof FormState) ||
          visibleFields.has('maxGradNorm' satisfies keyof FormState) ||
          visibleFields.has('seed' satisfies keyof FormState)) && (
          <div className="grid grid-cols-4 gap-x-4 gap-y-3">
            {visibleFields.has('weightDecay' satisfies keyof FormState) && (
              <div>
                <FormTitle>Weight Decay</FormTitle>
                <Input
                  type="text"
                  value={weightDecay}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val) && val >= 0)
                      onFieldChange('weightDecay', val);
                  }}
                  placeholder={String(defaults.weightDecay)}
                  className="w-full tabular-nums"
                />
                <p className="mt-1 text-xs text-slate-400">
                  L2 regularisation (0 = disabled)
                </p>
              </div>
            )}

            {visibleFields.has('maxGradNorm' satisfies keyof FormState) && (
              <div>
                <FormTitle>Max Gradient Norm</FormTitle>
                <Input
                  type="text"
                  value={maxGradNorm}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val) && val >= 0)
                      onFieldChange('maxGradNorm', val);
                  }}
                  placeholder={String(defaults.maxGradNorm)}
                  className="w-full tabular-nums"
                />
                <p className="mt-1 text-xs text-slate-400">
                  Clip gradients (0 = disabled, 1.0 standard)
                </p>
              </div>
            )}

            {visibleFields.has('seed' satisfies keyof FormState) && (
              <div>
                <FormTitle>Seed</FormTitle>
                <Input
                  type="number"
                  min={-1}
                  value={seed}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val) && val >= -1) onFieldChange('seed', val);
                  }}
                  className="w-full"
                />
                <p className="mt-1 text-xs text-slate-400">
                  -1 for random, fixed for reproducibility. Seeds the training
                  run, not sample generation.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Train Text Encoder + EMA checkboxes */}
        {visibleFields.has('trainTextEncoder' satisfies keyof FormState) && (
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
        {(visibleFields.has('backboneLR' satisfies keyof FormState) ||
          visibleFields.has('textEncoderLR' satisfies keyof FormState)) && (
          <div className="grid grid-cols-4 gap-x-4 gap-y-3">
            {visibleFields.has('backboneLR' satisfies keyof FormState) && (
              <div>
                <FormTitle>Backbone LR</FormTitle>
                <Input
                  type="text"
                  value={backboneLR}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val) && val >= 0)
                      onFieldChange('backboneLR', val);
                  }}
                  placeholder={String(defaults.backboneLR)}
                  className="w-full tabular-nums"
                />
                <p className="mt-1 text-xs text-slate-400">0 = use main LR</p>
              </div>
            )}

            {visibleFields.has('textEncoderLR' satisfies keyof FormState) && (
              <div>
                <FormTitle>Text Encoder LR</FormTitle>
                <Input
                  type="text"
                  value={textEncoderLR}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val) && val >= 0)
                      onFieldChange('textEncoderLR', val);
                  }}
                  placeholder={String(defaults.textEncoderLR)}
                  className="w-full tabular-nums"
                />
                <p className="mt-1 text-xs text-slate-400">0 = use main LR</p>
              </div>
            )}
          </div>
        )}

        {visibleFields.has('ema' satisfies keyof FormState) && (
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

        {/* Loss + Timestep row */}
        {(visibleFields.has('lossType' satisfies keyof FormState) ||
          visibleFields.has('timestepType' satisfies keyof FormState) ||
          visibleFields.has('timestepBias' satisfies keyof FormState)) && (
          <div className="grid grid-cols-3 gap-x-4 gap-y-3">
            {visibleFields.has('lossType' satisfies keyof FormState) && (
              <div>
                <FormTitle>Loss Type</FormTitle>
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

            {visibleFields.has('timestepType' satisfies keyof FormState) && (
              <div>
                <FormTitle>Timestep Type</FormTitle>
                <Dropdown
                  items={TIMESTEP_TYPE_ITEMS}
                  selectedValue={timestepType}
                  onChange={(val) => onFieldChange('timestepType', val)}
                  aria-label="Timestep type"
                />
              </div>
            )}

            {visibleFields.has('timestepBias' satisfies keyof FormState) && (
              <div>
                <FormTitle>Timestep Bias</FormTitle>
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
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
};

export const LearningSection = memo(LearningSectionComponent);
