import {
  CheckCircle2Icon,
  CircleDashedIcon,
  CircleDotIcon,
} from 'lucide-react';
import { memo, useMemo } from 'react';

import {
  type ModelComponentType,
  type ModelDefinition,
  OPTIMIZER_OPTIONS,
  SCHEDULER_OPTIONS,
} from '@/app/services/training/models';
import { parseNativeResolution } from '@/app/services/training/native-resolution';
import type { TrainingProvider } from '@/app/services/training/types';

import { KohyaBucketPreview } from './kohya-bucket-preview';
import { NativeResolutionPreview } from './native-resolution-preview';
import type { DatasetSource } from './training-config-form/use-training-config-form';

type TrainingSummaryProps = {
  outputName: string;
  outputFolder: string | null;
  currentModel: ModelDefinition;
  selectedProvider: TrainingProvider;
  modelPaths: Partial<Record<ModelComponentType, string>>;
  datasets: DatasetSource[];
  totalImages: number;
  totalEffective: number;
  durationMode: 'epochs' | 'steps';
  epochs: number;
  steps: number;
  calculatedSteps: number;
  calculatedEpochs: number;
  batchSize: number;
  learningRate: number;
  optimizer: string;
  scheduler: string;
  networkType: string;
  networkDim: number;
  networkAlpha: number;
  resolution: number[];
  nativeResolution: string;
  saveEnabled: boolean;
  saveMode: 'epochs' | 'steps';
  saveEveryEpochs: number;
  saveEverySteps: number;
  saveFormat: string;
  maxSavesToKeep: number;
  seed: number;
};

const ReadinessItem = ({
  label,
  isReady,
  detail,
  isSummary,
}: {
  label: string;
  isReady: boolean;
  detail?: string;
  isSummary?: boolean;
}) => {
  const NotReadyIcon = isSummary ? CircleDotIcon : CircleDashedIcon;
  const notReadyColour = isSummary ? 'text-amber-500' : 'text-slate-400';

  return (
    <div className="flex items-center gap-1.5">
      {isReady ? (
        <CheckCircle2Icon className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-500" />
      ) : (
        <NotReadyIcon
          className={`mt-px h-3.5 w-3.5 shrink-0 ${notReadyColour}`}
        />
      )}
      <div className="min-w-0">
        <span
          className={`text-xs ${isSummary ? 'font-medium' : ''} ${isReady ? 'text-(--foreground)/70' : isSummary ? 'text-(--foreground)/70' : 'text-slate-400'}`}
        >
          {label}
        </span>
        {detail && (
          <span className="ml-1 text-xs text-slate-400">{detail}</span>
        )}
      </div>
    </div>
  );
};

const SummaryRow = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <div className="flex items-baseline justify-between gap-2">
    <span className="shrink-0 text-xs text-slate-400">{label}</span>
    <span className="min-w-0 truncate text-right text-xs font-medium text-(--foreground)/70">
      {children}
    </span>
  </div>
);

const TrainingSummaryComponent = ({
  outputName,
  outputFolder,
  currentModel,
  selectedProvider,
  modelPaths,
  datasets,
  totalImages,
  totalEffective,
  durationMode,
  epochs,
  steps,
  calculatedSteps,
  calculatedEpochs,
  batchSize,
  learningRate,
  optimizer,
  scheduler,
  networkType,
  networkDim,
  networkAlpha,
  resolution,
  nativeResolution,
  saveEnabled,
  saveMode,
  saveEveryEpochs,
  saveEverySteps,
  saveFormat,
  maxSavesToKeep,
  seed,
}: TrainingSummaryProps) => {
  const hasOutputName = outputName.trim() !== '';
  const hasDataset = totalImages > 0;

  const requiredComponents = currentModel.components.filter((c) => c.required);
  const hasAllComponents = requiredComponents.every((c) =>
    modelPaths[c.type]?.trim(),
  );

  const effectiveSteps = durationMode === 'epochs' ? calculatedSteps : steps;
  const effectiveEpochs = durationMode === 'steps' ? calculatedEpochs : epochs;

  const checkpointCount = useMemo(() => {
    if (!saveEnabled || !hasDataset) return 0;
    if (saveMode === 'epochs') {
      return saveEveryEpochs > 0
        ? Math.floor(effectiveEpochs / saveEveryEpochs)
        : 0;
    }
    return saveEverySteps > 0 ? Math.floor(effectiveSteps / saveEverySteps) : 0;
  }, [
    saveEnabled,
    hasDataset,
    saveMode,
    saveEveryEpochs,
    saveEverySteps,
    effectiveEpochs,
    effectiveSteps,
  ]);

  const optimizerLabel = useMemo(() => {
    for (const group of OPTIMIZER_OPTIONS) {
      const match = group.items.find((o) => o.value === optimizer);
      if (match) return match.label;
    }
    return optimizer;
  }, [optimizer]);

  const schedulerLabel = useMemo(() => {
    return (
      SCHEDULER_OPTIONS.find((s) => s.value === scheduler)?.label ?? scheduler
    );
  }, [scheduler]);

  // An exact WxH size disables bucketing, so the bucket preview would show
  // sizes the run will never use — swap it for the native-size panel instead.
  const native = useMemo(
    () => parseNativeResolution(nativeResolution).value,
    [nativeResolution],
  );

  const isKohya = selectedProvider === 'kohya';
  const showNative = isKohya && native !== null && datasets.length > 0;
  const showBuckets =
    isKohya && !native && resolution.length > 0 && datasets.length > 0;

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-4 lg:grid-cols-1">
      {/* Training overview */}
      <div className="rounded-lg border border-slate-200 bg-(--surface)/30 p-3 dark:border-slate-700">
        <span className="mb-2 block text-xs font-medium text-(--foreground)/70">
          Overview
        </span>
        <div className="space-y-1">
          <SummaryRow label="Model">{currentModel.name}</SummaryRow>
          <SummaryRow label="Resolution">
            {native
              ? `${native.width}×${native.height} (native)`
              : resolution.join(', ')}
          </SummaryRow>
          {hasDataset && (
            <>
              <SummaryRow label="Images">
                {totalImages.toLocaleString()}
                {totalEffective !== totalImages &&
                  ` (${totalEffective.toLocaleString()} eff.)`}
              </SummaryRow>
              <SummaryRow label="Duration">
                {effectiveEpochs > 0
                  ? `${effectiveEpochs} ${effectiveEpochs !== 1 ? 'epochs' : 'epoch'}`
                  : '—'}
                {' / '}
                {effectiveSteps > 0
                  ? `${effectiveSteps.toLocaleString()} steps`
                  : '—'}
              </SummaryRow>
            </>
          )}
          <SummaryRow label="Batch size">{batchSize}</SummaryRow>
          <SummaryRow label="Seed">{seed === -1 ? 'Random' : seed}</SummaryRow>
          {saveEnabled && checkpointCount > 0 && (
            <SummaryRow label="Checkpoints">
              ~{checkpointCount}
              {maxSavesToKeep > 0 && maxSavesToKeep < checkpointCount && (
                <span className="font-normal text-slate-400">
                  {' '}
                  (keep {maxSavesToKeep})
                </span>
              )}
            </SummaryRow>
          )}
        </div>
      </div>

      {/* Bucketing (Kohya only) */}
      {showBuckets && (
        <div className="rounded-lg border border-slate-200 bg-(--surface)/30 p-3 dark:border-slate-700">
          <span className="mb-2 block text-xs font-medium text-(--foreground)/70">
            Buckets
          </span>
          <KohyaBucketPreview
            baseResolution={resolution[0]}
            datasets={datasets}
          />
        </div>
      )}

      {/* Exact WxH size (Kohya only) — replaces the bucket panel */}
      {showNative && native && (
        <div className="rounded-lg border border-slate-200 bg-(--surface)/30 p-3 dark:border-slate-700">
          <span className="mb-2 block text-xs font-medium text-(--foreground)/70">
            Native Resolution
          </span>
          <NativeResolutionPreview
            width={native.width}
            height={native.height}
            datasets={datasets}
          />
        </div>
      )}

      {/* LoRA & optimiser */}
      <div className="rounded-lg border border-slate-200 bg-(--surface)/30 p-3 dark:border-slate-700">
        <span className="mb-2 block text-xs font-medium text-(--foreground)/70">
          Network & Optimiser
        </span>
        <div className="space-y-1">
          <SummaryRow label="Type">{networkType.toUpperCase()}</SummaryRow>
          <SummaryRow label="Rank / Alpha">
            {networkDim} / {networkAlpha}
          </SummaryRow>
          <SummaryRow label="LR">{learningRate}</SummaryRow>
          <SummaryRow label="Optimiser">{optimizerLabel}</SummaryRow>
          <SummaryRow label="Scheduler">{schedulerLabel}</SummaryRow>
          <SummaryRow label="Save format">{saveFormat}</SummaryRow>
        </div>
      </div>

      {/* Readiness */}
      <div className="rounded-lg border border-slate-200 bg-(--surface)/30 p-3 dark:border-slate-700">
        <span className="mb-2 block text-xs font-medium text-(--foreground)/70">
          Training Readiness
        </span>

        <div className="space-y-1">
          {requiredComponents.length > 1 && (
            <>
              <span className="mb-1 block text-xs font-medium text-(--foreground)/70">
                Model files
              </span>
              {requiredComponents.map((component) => (
                <ReadinessItem
                  key={component.type}
                  label={component.label}
                  isReady={!!modelPaths[component.type]?.trim()}
                />
              ))}
              <hr className="my-3 text-slate-300 dark:text-slate-600" />
            </>
          )}

          {requiredComponents.length === 1 && (
            <ReadinessItem
              label={requiredComponents[0].label}
              isReady={!!modelPaths[requiredComponents[0].type]?.trim()}
            />
          )}

          <ReadinessItem
            label="Dataset"
            isReady={hasDataset}
            detail={
              hasDataset
                ? `${totalImages} ${totalImages !== 1 ? 'images' : 'image'}`
                : undefined
            }
          />

          <ReadinessItem
            label="Output name"
            isReady={hasOutputName}
            detail={hasOutputName ? outputName : undefined}
          />

          {outputFolder && (
            <div className="pl-5">
              <span
                className="block truncate text-xs text-slate-400"
                title={outputFolder}
              >
                Saves to{' '}
                <span className="text-(--foreground)/60">{outputFolder}</span>
              </span>
            </div>
          )}

          <hr className="my-3 text-slate-300 dark:text-slate-600" />

          <ReadinessItem
            label={
              hasOutputName && hasDataset && hasAllComponents
                ? 'Ready to train'
                : 'Not ready'
            }
            isReady={hasOutputName && hasDataset && hasAllComponents}
            isSummary
          />
        </div>
      </div>
    </div>
  );
};

export const TrainingSummary = memo(TrainingSummaryComponent);
