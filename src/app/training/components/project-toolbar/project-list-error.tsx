'use client';

import { RefreshCwIcon, TriangleAlertIcon } from 'lucide-react';
import { memo } from 'react';

type ProjectListErrorProps = {
  /** Message from the failed fetch. */
  error: string | null;
  onRetry: () => void;
};

/**
 * Shown wherever the saved-projects list failed to load.
 *
 * Says "couldn't read" rather than "none found", because those look identical
 * from an empty array and only one of them is worth restarting the app over.
 * The underlying message is kept — it's the difference between a handler error
 * and a route that never matched.
 */
const ProjectListErrorComponent = ({
  error,
  onRetry,
}: ProjectListErrorProps) => (
  // Width is capped because this also renders inside the project menu, which
  // is a shrink-to-fit popup — an unwrapped one-line diagnostic would stretch
  // it across the whole viewport.
  <div className="flex max-w-96 flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
    <div className="flex items-center gap-1.5">
      <TriangleAlertIcon className="h-4 w-4 shrink-0 text-amber-500" />
      <span className="text-sm font-medium text-amber-500">
        Couldn’t load saved projects
      </span>
    </div>
    <p className="text-sm text-(--foreground)/70">
      Your projects are still on disk — this is a failed request, not missing
      data.
      {error ? (
        <span className="mt-1 block wrap-anywhere text-slate-400">{error}</span>
      ) : null}
    </p>
    <button
      type="button"
      onClick={onRetry}
      className="flex cursor-pointer items-center gap-1.5 self-start rounded-md px-2 py-1 text-sm font-medium text-sky-600 transition-colors hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-900/30"
    >
      <RefreshCwIcon className="h-3.5 w-3.5" />
      Retry
    </button>
  </div>
);

export const ProjectListError = memo(ProjectListErrorComponent);
