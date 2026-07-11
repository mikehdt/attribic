import { TRAINING_PROVIDER_LABELS } from '@/app/services/training/types';
import type { TrainingJob } from '@/app/store/jobs';

import {
  deriveSavedCount,
  formatDuration,
  formatEta,
  formatLoss,
} from '../helpers';
import { LossChart } from '../loss-chart/loss-chart';
import { SpeedChart } from '../speed-chart/speed-chart';
import { useTrainingDetailView } from './use-training-detail-view';

function Stat({ label, value }: { label: string; value: string | null }) {
  if (value == null) return null;
  return (
    <div className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-800/60">
      <div className="text-xs text-slate-400 uppercase">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-(--foreground) tabular-nums">
        {value}
      </div>
    </div>
  );
}

/**
 * The body of a training job's detail view: loss graph, per-stat parameters,
 * and recent log. Rendered inside a `Modal` by the activity panel's
 * `TrainingDetailModal` (live job) and inline by the run-history modal
 * (archived snapshot). Reads nothing from Redux — the job is passed in.
 */
export function TrainingDetailContent({ job }: { job: TrainingJob | null }) {
  const { progress, config, lrCurve, logRef, handleLogScroll } =
    useTrainingDetailView(job);

  if (!job || !progress) return null;

  const isRunning = job.status === 'running' || job.status === 'preparing';
  const isCompleted = job.status === 'completed';

  const currentStep = progress.currentStep ?? 0;
  const totalSteps = progress.totalSteps ?? 0;
  const savedCheckpoints = progress.savedCheckpoints ?? [];
  const checkpointSteps = progress.checkpointSteps ?? [];
  const speedHistory = progress.speedHistory ?? [];
  const savedCount = deriveSavedCount(progress);

  const elapsed =
    progress.completedAt != null && progress.startedAt != null
      ? progress.completedAt - progress.startedAt
      : null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-medium text-(--foreground)">
          {config?.outputName || 'Training run'}
        </h2>
        <p className="text-xs text-slate-400">
          {TRAINING_PROVIDER_LABELS[config?.provider ?? 'mock']}
          {isCompleted && elapsed != null
            ? ` · Completed in ${formatDuration(elapsed)}`
            : ''}
        </p>
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-slate-400 uppercase">Loss</span>
        </div>
        <div className="mt-1 rounded border border-slate-300 bg-slate-100 p-2 dark:border-slate-600 dark:bg-slate-900">
          <LossChart
            lossHistory={progress.lossHistory ?? []}
            totalSteps={totalSteps}
            currentStep={currentStep}
            totalEpochs={progress.totalEpochs}
            checkpointSteps={checkpointSteps}
            savedCheckpoints={savedCheckpoints}
            lrCurve={lrCurve}
            variant="detail"
            width={640}
            height={220}
            className="w-full"
          />
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3 rounded-full bg-emerald-600" />
            Loss
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3 rounded-full bg-amber-600" />
            Smoothed
          </span>
          {lrCurve && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-3 rounded-sm border-t border-sky-600/60 bg-sky-600/15" />
              LR schedule
            </span>
          )}
          {savedCheckpoints.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-0.5 bg-violet-500/70 dark:bg-violet-400/70" />
              Saved checkpoint
            </span>
          )}
          {checkpointSteps.some((s) => s > currentStep) && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-0.5 border-l border-dashed border-slate-400/70" />
              Upcoming checkpoint
            </span>
          )}
          {progress.totalEpochs >= 2 && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-0.5 border-l border-dashed border-slate-300/70 dark:border-slate-600/60" />
              Epoch
            </span>
          )}
        </div>
      </div>

      {speedHistory.length > 0 && (
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-slate-400 uppercase">Speed</span>
            <span className="text-xs text-slate-400">s/it</span>
          </div>
          <div className="mt-1 rounded border border-slate-300 bg-slate-100 p-2 dark:border-slate-600 dark:bg-slate-900">
            <SpeedChart
              speedHistory={speedHistory}
              totalSteps={totalSteps}
              width={640}
              height={90}
              className="w-full"
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Step"
          value={
            totalSteps > 0
              ? `${currentStep.toLocaleString()} / ${totalSteps.toLocaleString()}`
              : '—'
          }
        />
        <Stat
          label="Epoch"
          value={
            progress.totalEpochs > 0
              ? `${progress.currentEpoch} / ${progress.totalEpochs}`
              : '—'
          }
        />
        <Stat
          label="Loss"
          value={progress.loss !== null ? formatLoss(progress.loss) : '—'}
        />
        <Stat
          label="Learning rate"
          value={
            progress.learningRate !== null ? String(progress.learningRate) : '—'
          }
        />
        <Stat
          label="ETA"
          value={
            progress.etaSeconds !== null && progress.etaSeconds > 0
              ? formatEta(progress.etaSeconds)
              : '—'
          }
        />
        <Stat label="Speed" value={progress.speed ?? '—'} />
        <Stat
          label="Phase"
          value={progress.phase ?? (isRunning ? 'Training' : '—')}
        />
        <Stat
          label="Checkpoints"
          value={savedCount > 0 ? String(savedCount) : '—'}
        />
      </div>

      <div>
        <span className="text-xs text-slate-400 uppercase">Recent log</span>
        <div
          ref={logRef}
          onScroll={handleLogScroll}
          className="mt-1 max-h-48 overflow-y-auto rounded border border-slate-300 bg-slate-100 p-2 font-mono text-[11px] text-slate-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300"
        >
          {progress.logLines && progress.logLines.length > 0 ? (
            progress.logLines.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap">
                {line}
              </div>
            ))
          ) : (
            <span className="text-slate-400">No log output yet</span>
          )}
        </div>
      </div>

      {job.status === 'failed' && progress.error && (
        <pre className="max-h-40 overflow-auto font-mono text-[11px] whitespace-pre-wrap text-rose-500">
          {progress.error}
        </pre>
      )}
    </div>
  );
}
