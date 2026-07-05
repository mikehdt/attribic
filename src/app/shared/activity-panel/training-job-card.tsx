import { XIcon } from 'lucide-react';
import { useMemo } from 'react';

import { SCHEDULER_OPTIONS } from '@/app/services/training/models';
import { useAppDispatch } from '@/app/store/hooks';
import { type TrainingJob } from '@/app/store/jobs';
import {
  cancelTraining,
  clearTrainingJob,
} from '@/app/store/training/training-runtime';
import { SchedulerSparkline } from '@/app/training/components/scheduler-sparkline';

import { ProgressBar } from '../progress-bar/progress-bar';
import { ActionButton } from './action-button';
import { formatDuration } from './helpers';

const TQDM_RE = /(\d+)\/(\d+)\s+\[/;

/** Format an ETA in seconds as a compact "1h 3m" / "4m 12s" / "45s". */
function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

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

export function TrainingJobCard({ job }: { job: TrainingJob }) {
  const dispatch = useAppDispatch();

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
    ? Math.round((progress!.currentStep / progress!.totalSteps) * 100)
    : 0;
  const prepPct = hasPrepCount
    ? Math.round((progress!.currentStep / progress!.totalSteps) * 100)
    : 0;

  const elapsed =
    progress?.completedAt != null && progress.startedAt != null
      ? progress.completedAt - progress.startedAt
      : null;

  const checkpointPositions = progress?.checkpointSteps ?? [];
  const savedCount = checkpointPositions.length;

  // Prefer the phase label the provider sends (survives rapid tqdm redraws);
  // fall back to scraping it out of the recent log lines (ai-toolkit, and
  // early phases before any structured phase is reported).
  const preparingPhase = useMemo(
    () => progress?.phase ?? derivePreparingPhase(progress?.logLines),
    [progress?.phase, progress?.logLines],
  );

  const schedulerCurve = useMemo(() => {
    const schedulerName = config?.hyperparameters?.scheduler;
    if (!schedulerName) return null;
    return (
      SCHEDULER_OPTIONS.find((s) => s.value === schedulerName)?.curve ?? null
    );
  }, [config]);

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
          {isRunning && (
            <ActionButton
              onClick={() => dispatch(cancelTraining(job.id))}
              title="Cancel training"
              variant="danger"
            >
              <XIcon className="h-2.5 w-2.5" />
              Cancel
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

      {/* Scheduler curve */}
      {schedulerCurve && isRunning && (
        <div className="border-t border-dashed border-(--border-subtle) px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 uppercase">
              LR Schedule
            </span>
            {progress?.learningRate != null && (
              <span className="text-xs text-slate-400 tabular-nums">
                LR {progress.learningRate}
              </span>
            )}
          </div>
          <div className="mt-1 rounded border border-slate-300 bg-slate-200 p-1 dark:border-slate-600 dark:bg-slate-800">
            <SchedulerSparkline
              curve={schedulerCurve}
              width={264}
              height={40}
              className="w-full text-sky-500"
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
              marks={checkpointPositions}
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
            {isRunning && (
              <div className="mt-1 text-xs">
                <span className="truncate text-sky-600 dark:text-sky-400">
                  {progress!.phase ?? 'Training'}
                </span>
              </div>
            )}
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
              <span className="font-medium text-(--foreground)">{prepPct}%</span>
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
          (progress.loss !== null ||
            progress.speed !== null ||
            (progress.etaSeconds !== null && progress.etaSeconds > 0)) && (
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-400">
            {progress.loss !== null && (
              <span>
                Loss{' '}
                <span className="font-medium text-(--foreground)">
                  {progress.loss}
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
              <span>
                ETA{' '}
                <span className="font-medium text-(--foreground)">
                  {formatEta(progress.etaSeconds)}
                </span>
              </span>
            )}
            {savedCount > 0 && (
              <span>
                {savedCount} checkpoint{savedCount !== 1 ? 's' : ''} saved
              </span>
            )}
          </div>
        )}

        {isCompleted && (
          <p className="mt-1.5 text-xs text-green-600 dark:text-green-400">
            Complete{elapsed != null ? ` in ${formatDuration(elapsed)}` : ''}
            {savedCount > 0 &&
              ` · ${savedCount} checkpoint${savedCount !== 1 ? 's' : ''}`}
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
