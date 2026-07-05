import type { ProviderType } from '@/app/services/auto-tagger';
import { Button } from '@/app/shared/button';
import { ProgressBar } from '@/app/shared/progress-bar/progress-bar';
import type { JobStatus, TaggingProgress } from '@/app/store/jobs';

type AutoTaggerProgressProps = {
  progress: TaggingProgress | null;
  jobStatus: JobStatus | null;
  providerType?: ProviderType;
  onCancel: () => void;
  onLeave?: () => void;
};

export function AutoTaggerProgress({
  progress,
  jobStatus,
  providerType,
  onCancel,
  onLeave,
}: AutoTaggerProgressProps) {
  // `current` is the number of images completed so far (0 at start, total at end).
  // The "currently on" label is one ahead, clamped to total so it doesn't overshoot.
  const completed = progress?.current ?? 0;
  const total = progress?.total ?? 0;
  const currentlyOn = total > 0 ? Math.min(completed + 1, total) : 0;

  const loading = progress?.loading;
  const isLoading = loading !== undefined;
  const queued = progress?.queued;
  const isQueued = queued !== undefined;
  // "Starting" = the job has been created but the backend hasn't emitted any
  // event yet (no queue placement, no loading shards, no per-image progress).
  // Avoids the misleading "Tagging image 1 of N" + empty bar that briefly
  // appears before the model has even begun loading.
  const isStarting = jobStatus === 'preparing' && !isLoading && !isQueued;
  const isCaptioning = providerType === 'vlm';
  const verbPresent = isCaptioning ? 'Captioning' : 'Tagging';
  const startingVerb = isCaptioning ? 'captioner' : 'tagger';
  const finishedNote = isCaptioning
    ? 'Captions from completed images will still be applied.'
    : 'Tags from completed images will still be applied.';

  return (
    <div className="flex flex-col gap-4">
      {isQueued ? (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Waiting for the GPU...
          </p>
          <div className="flex flex-col gap-2">
            <ProgressBar color="indigo" indeterminate />
            <p className="truncate text-xs text-slate-500">
              Queued behind other work — position {queued.position} in line. It
              will start automatically.
            </p>
          </div>
        </>
      ) : isStarting ? (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Starting auto-{startingVerb}...
          </p>
          <div className="flex flex-col gap-2">
            <ProgressBar color="indigo" indeterminate />
            <p className="truncate text-xs text-slate-500">Preparing model</p>
          </div>
        </>
      ) : isLoading ? (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Loading model...
          </p>
          <div className="flex flex-col gap-2">
            <ProgressBar
              value={loading.current}
              max={loading.total || 1}
              color="indigo"
              indeterminate={loading.total === 0}
            />
            <p className="truncate text-xs text-slate-500">
              {loading.message}
              {loading.total > 0 && ` (${loading.current}/${loading.total})`}
            </p>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {verbPresent} image {currentlyOn} of {total}...
          </p>
          <div className="flex flex-col gap-2">
            <ProgressBar
              value={completed}
              max={total || 1}
              color="indigo"
              indeterminate={!progress}
            />
            <p className="truncate text-xs text-slate-500">
              {progress?.currentFileId || 'Processing...'}
            </p>
          </div>
        </>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">{finishedNote}</p>
        <div className="flex gap-2">
          {onLeave && (
            <Button onClick={onLeave} color="slate" size="md">
              Go to Projects
            </Button>
          )}
          <Button onClick={onCancel} color="slate" size="md">
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
