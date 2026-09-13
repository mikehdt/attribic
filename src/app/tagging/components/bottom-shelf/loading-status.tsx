import { Loader } from '@/app/shared/loader';
import { ProgressBar } from '@/app/shared/progress-bar/progress-bar';
import { IoState, LoadProgress, SaveProgress } from '@/app/store/assets';

interface LoadingStatusProps {
  ioState: IoState;
  saveProgress: SaveProgress | null;
  loadProgress: LoadProgress | null;
  /**
   * The deferred archive load runs alongside a settled project, so it reports
   * progress without moving the slice's own `ioState`.
   */
  isArchiveLoading?: boolean;
}

export const LoadingStatus = ({
  ioState,
  saveProgress,
  loadProgress,
  isArchiveLoading = false,
}: LoadingStatusProps) => {
  const hasProgress =
    (saveProgress?.total && saveProgress.total > 0) ||
    (loadProgress?.total && loadProgress.total > 0);

  const isLoading =
    isArchiveLoading ||
    ioState === IoState.LOADING ||
    ioState === IoState.COMPLETING;

  return (
    <>
      <div className="border border-white/0 px-1 py-0.5">
        <Loader className="h-6 w-6" />
      </div>

      <div className="ml-1 text-xs font-medium text-(--foreground) tabular-nums">
        {(ioState === IoState.SAVING || ioState === IoState.COMPLETING) &&
        saveProgress?.total ? (
          <>
            {saveProgress.completed} / {saveProgress.total}
            {saveProgress.failed > 0 &&
              ` (${saveProgress.failed} ${saveProgress.failed !== 1 ? 'errors' : 'error'})`}
          </>
        ) : null}

        {isLoading && loadProgress?.total ? (
          <>
            {loadProgress.total > 0
              ? `${loadProgress.completed} / ${loadProgress.total}`
              : ''}
            {loadProgress.failed > 0
              ? ` (${loadProgress.failed} ${loadProgress.failed !== 1 ? 'errors' : 'error'})`
              : ''}
          </>
        ) : null}

        {(isLoading || ioState === IoState.SAVING) &&
        !saveProgress?.total &&
        !loadProgress?.total ? (
          <>Preparing...</>
        ) : null}

        {/* Mini progress bar */}
        {hasProgress ? (
          <ProgressBar
            value={
              saveProgress?.total
                ? saveProgress.completed
                : (loadProgress?.completed ?? 0)
            }
            max={
              saveProgress?.total
                ? saveProgress.total
                : (loadProgress?.total ?? 1)
            }
            size="sm"
            color="teal"
            className="mt-1 w-24"
          />
        ) : null}
      </div>
    </>
  );
};
