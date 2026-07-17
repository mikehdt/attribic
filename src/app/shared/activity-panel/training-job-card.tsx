import { Maximize2Icon, XIcon } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { useConfirmAction } from '@/app/shared/use-confirm-action';
import { useAppDispatch } from '@/app/store/hooks';
import { type TrainingJob } from '@/app/store/jobs';
import {
  cancelTraining,
  clearTrainingJob,
} from '@/app/store/training/training-runtime';

import { ProgressBar } from '../progress-bar/progress-bar';
import { ActionButton } from './action-button';
import {
  deriveSavedCount,
  formatDuration,
  formatEta,
  formatLoss,
  formatPct,
} from './helpers';
import { LossChart } from './loss-chart/loss-chart';
import { useLrScheduleCurve } from './use-lr-schedule-curve';

const TQDM_RE = /(\d+)\/(\d+)\s+\[/;

/**
 * Turn the most recent sidecar log lines into a short, readable phase
 * label so the activity card can show "Caching latents (3/4)" instead of
 * a raw tqdm string or a silent "Preparing…". Walks backwards through
 * the log tail to pick up the latest progress bar, classifying it from
 * nearby context when the bar itself has no prefix.
 */
function derivePreparingPhase(lines: string[] | undefined): string | null {
  if (!lines || lines.length === 0) return null;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const tqdm = line.match(TQDM_RE);
    if (tqdm) {
      const counter = `${tqdm[1]}/${tqdm[2]}`;
      const context = [line, ...lines.slice(Math.max(0, i - 5), i)]
        .join(' ')
        .toLowerCase();
      if (/cach.*latent/.test(context)) return `Caching latents (${counter})`;
      if (/text.*(encod|embed)|cach.*text/.test(context))
        return `Encoding text (${counter})`;
      return `Processing (${counter})`;
    }

    const l = line.toLowerCase();
    // Sidecar-emitted setup phases (before the training backend starts).
    if (/starting.*(ai-toolkit|server)/.test(l)) return 'Starting backend';
    if (/server ready/.test(l)) return 'Backend ready';
    if (/submitting/.test(l)) return 'Submitting job';
    if (/job created/.test(l)) return 'Job created';
    if (/waiting.*worker/.test(l)) return 'Waiting for worker';
    // Training backend phases.
    if (/load.*(model|transformer|pipeline)/.test(l)) return 'Loading model';
    if (/quantiz/.test(l)) return 'Quantizing';
    if (/cach.*latent/.test(l)) return 'Caching latents';
    if (/text.*(encod|embed)/.test(l)) return 'Encoding text';
    if (/start.*train|begin.*train/.test(l)) return 'Starting training';
  }

  return null;
}

export function TrainingJobCard({
  job,
  onEnlarge,
}: {
  job: TrainingJob;
  onEnlarge: (jobId: string) => void;
}) {
  const dispatch = useAppDispatch();

  // Cancel is a two-step confirm — the button sits right beside Enlarge in a
  // cramped row, so a stray click shouldn't kill a long run.
  const handleConfirmCancel = useCallback(() => {
    dispatch(cancelTraining(job.id));
  }, [dispatch, job.id]);
  const { armed: confirmingCancel, trigger: handleCancelClick } =
    useConfirmAction(handleConfirmCancel);

  const isRunning = job.status === 'running' || job.status === 'preparing';
  const isCompleted = job.status === 'completed';
  const isFailed = job.status === 'failed';
  const isDone = !isRunning;

  const progress = job.progress;
  const config = job.config;

  const isPreparing = job.status === 'preparing';

  // During preparing, currentStep/totalSteps carry the setup phase's own
  // item count (e.g. latents cached), not training steps — keep the two
  // apart so caching doesn't render as "Step 45 / 98".
  const hasStepInfo = !isPreparing && (progress?.totalSteps ?? 0) > 0;
  const hasPrepCount = isPreparing && (progress?.totalSteps ?? 0) > 0;

  const pct = hasStepInfo
    ? formatPct(progress!.currentStep, progress!.totalSteps)
    : '0.0';
  const prepPct = hasPrepCount
    ? formatPct(progress!.currentStep, progress!.totalSteps)
    : '0.0';

  const elapsed =
    progress?.completedAt != null && progress.startedAt != null
      ? progress.completedAt - progress.startedAt
      : null;

  const checkpointPositions = progress?.checkpointSteps ?? [];
  const savedCount = deriveSavedCount(progress);
  const lrCurve = useLrScheduleCurve(config, progress?.totalSteps ?? 0);

  // Prefer the phase label the provider sends (survives rapid tqdm redraws);
  // fall back to scraping it out of the recent log lines (ai-toolkit, and
  // early phases before any structured phase is reported).
  const preparingPhase = useMemo(
    () => progress?.phase ?? derivePreparingPhase(progress?.logLines),
    [progress?.phase, progress?.logLines],
  );

  return (
    <div className="border-b border-(--border-subtle) inset-shadow-sm inset-shadow-slate-100 last:border-b-0 dark:inset-shadow-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span
          className={`h-2 w-2 rounded-full p-1 ${
            isRunning
              ? 'animate-pulse bg-sky-500'
              : isCompleted
                ? 'bg-green-500'
                : isFailed
                  ? 'bg-rose-500'
                  : 'bg-slate-400'
          }`}
        />
        <span className="text-xs font-medium text-(--foreground)">
          {config?.outputName || 'Training'}
        </span>

        {/* Actions */}
        <div className="ml-auto flex items-center gap-1 border-t border-dashed border-(--border-subtle)">
          {progress && (
            <ActionButton onClick={() => onEnlarge(job.id)} title="Enlarge">
              <Maximize2Icon className="h-2.5 w-2.5" />
              Enlarge
            </ActionButton>
          )}
          {isRunning && (
            <ActionButton
              onClick={handleCancelClick}
              title={
                confirmingCancel
                  ? 'Click again to confirm cancellation'
                  : 'Cancel training'
              }
              variant="danger"
            >
              <XIcon className="h-2.5 w-2.5" />
              {confirmingCancel ? 'Confirm?' : 'Cancel'}
            </ActionButton>
          )}
          {isDone && (
            <>
              <div className="mr-auto" />
              <ActionButton
                onClick={() => dispatch(clearTrainingJob(job.id))}
                title="Clear from list"
              >
                <XIcon className="h-2.5 w-2.5" />
                Clear
              </ActionButton>
            </>
          )}
        </div>
      </div>

      {/* Loss curve, over the LR schedule as a background layer. The current
          loss rides in the header rather than the stats row below, so it sits
          beside the curve it belongs to. */}
      {isRunning && (
        <div className="border-t border-dashed border-(--border-subtle) px-3 pb-2">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-slate-400 uppercase">Loss</span>
            {progress?.loss != null && (
              <span className="text-xs font-medium text-(--foreground) tabular-nums">
                {formatLoss(progress.loss)}
              </span>
            )}
          </div>
          <div className="mt-1 rounded border border-slate-300 bg-slate-200 p-1 dark:border-slate-600 dark:bg-slate-800">
            <LossChart
              lossHistory={progress?.lossHistory ?? []}
              totalSteps={progress?.totalSteps ?? 0}
              currentStep={progress?.currentStep ?? 0}
              totalEpochs={progress?.totalEpochs ?? 0}
              checkpointSteps={checkpointPositions}
              savedCheckpoints={progress?.savedCheckpoints ?? []}
              lrCurve={lrCurve}
              variant="compact"
              width={264}
              height={40}
              className="w-full"
            />
          </div>
        </div>
      )}

      {/* Progress */}
      <div className="px-3 pb-2.5">
        {hasStepInfo ? (
          <>
            <ProgressBar
              value={progress!.currentStep}
              max={progress!.totalSteps}
              color={isCompleted ? 'green' : isFailed ? 'red' : 'sky'}
              size={isCompleted ? 'xs' : 'sm'}
            />

            <div className="mt-2 flex items-baseline justify-between text-xs tabular-nums">
              <span className="text-slate-500">
                {`Step ${progress!.currentStep.toLocaleString()} / ${progress!.totalSteps.toLocaleString()}`}
              </span>
              <span className="font-medium text-(--foreground)">{pct}%</span>
            </div>

            {/* Activity line — names what the trainer is doing right now, so a
                frozen step bar (mid checkpoint save) doesn't look hung. */}
            <div className="mt-1 flex w-full text-xs">
              {isRunning && (
                <span className="truncate text-sky-600 dark:text-sky-400">
                  {progress!.phase ?? 'Training'}
                </span>
              )}
              {savedCount > 0 && (
                <span className="ml-auto text-slate-600 dark:text-slate-400">
                  {savedCount} {savedCount !== 1 ? 'checkpoints' : 'checkpoint'}{' '}
                  saved
                </span>
              )}
            </div>
          </>
        ) : isRunning && hasPrepCount ? (
          <>
            <ProgressBar
              value={progress!.currentStep}
              max={progress!.totalSteps}
              color="sky"
            />
            <div className="mt-2 flex items-baseline justify-between text-xs tabular-nums">
              <span className="text-slate-500">
                {preparingPhase ?? 'Preparing'}{' '}
                {`${progress!.currentStep.toLocaleString()} / ${progress!.totalSteps.toLocaleString()}`}
              </span>
              <span className="font-medium text-(--foreground)">
                {prepPct}%
              </span>
            </div>
          </>
        ) : isRunning ? (
          <>
            <ProgressBar value={0} max={1} color="sky" indeterminate />
            <div className="mt-2 flex flex-col gap-0.5 text-xs text-slate-500">
              <span>
                Preparing
                {preparingPhase ? ` · ${preparingPhase}` : '…'}
              </span>
              {progress?.logLines && progress.logLines.length > 0 && (
                <span className="truncate font-mono text-[10px] text-slate-400">
                  {progress.logLines[progress.logLines.length - 1]}
                </span>
              )}
            </div>
          </>
        ) : null}

        {progress &&
          (progress.speed !== null ||
            progress.trainingSeconds > 0 ||
            (progress.etaSeconds !== null && progress.etaSeconds > 0)) && (
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-400 tabular-nums">
              {progress.trainingSeconds > 0 && (
                <span>
                  Train{' '}
                  <span className="font-medium text-(--foreground)">
                    {formatDuration(progress.trainingSeconds * 1000)}
                  </span>
                </span>
              )}
              {progress.speed && (
                <span>
                  Speed{' '}
                  <span className="font-medium text-(--foreground)">
                    {progress.speed}
                  </span>
                </span>
              )}
              {progress.etaSeconds !== null && progress.etaSeconds > 0 && (
                <span className="ml-auto">
                  ETA{' '}
                  <span className="font-medium text-(--foreground)">
                    {formatEta(progress.etaSeconds)}
                  </span>
                </span>
              )}
            </div>
          )}

        {isCompleted && (
          <p className="mt-1.5 text-xs text-green-600 dark:text-green-400">
            Complete{elapsed != null ? ` in ${formatDuration(elapsed)}` : ''}
            {(progress?.trainingSeconds ?? 0) > 0 &&
              ` · ${formatDuration(progress!.trainingSeconds * 1000)} training`}
            {savedCount > 0 &&
              ` · ${savedCount} ${savedCount !== 1 ? 'checkpoints' : 'checkpoint'}`}
          </p>
        )}
        {isFailed && progress?.error && (
          <pre className="mt-1.5 max-h-40 overflow-auto font-mono text-[10px] whitespace-pre-wrap text-rose-500">
            {progress.error}
          </pre>
        )}
      </div>
    </div>
  );
}
