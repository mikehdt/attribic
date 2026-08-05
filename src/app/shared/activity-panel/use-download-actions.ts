/**
 * Shared download lifecycle handlers — start, retry, cancel, delete partial,
 * and uninstall a fully-downloaded model.
 *
 * Used by the activity panel cards and by the in-modal rows in the
 * Model Manager so both surfaces share the same logic and side effects.
 *
 * Every action is a thin wrapper over the download runtime thunks: the sidecar
 * owns the transfers themselves, so there's nothing to abort or queue here.
 *
 * Auto-tagger slice mirroring is handled by middleware on setModelStatus,
 * so callers here only need to dispatch model-manager updates.
 */

import { useCallback } from 'react';

import type {
  DownloadableModel,
  ModelVariant,
} from '@/app/services/model-manager/types';
import { useAppDispatch } from '@/app/store/hooks';
import { type DownloadJob } from '@/app/store/jobs';
import {
  cancelDownload,
  removeDownload,
  retryDownload,
  startDownload,
} from '@/app/store/jobs/download-runtime';
import { setModelStatus } from '@/app/store/model-manager';

export function useDownloadActions() {
  const dispatch = useAppDispatch();

  /**
   * Kick off a download. Accepts either a `DownloadableModel` (with optional
   * variant) or a plain `{ id, name }` pair for callers that don't have a
   * full registry entry handy (e.g. the auto-tagger tab's `ModelInfo`).
   */
  const start = useCallback(
    (
      model: DownloadableModel | { id: string; name: string },
      variant?: ModelVariant,
    ) => {
      void dispatch(
        startDownload({
          modelId: model.id,
          modelName: model.name,
          variantId: variant?.id,
        }),
      );
    },
    [dispatch],
  );

  const retry = useCallback(
    (job: DownloadJob) => {
      void dispatch(retryDownload(job));
    },
    [dispatch],
  );

  const cancel = useCallback(
    (job: DownloadJob) => {
      void dispatch(cancelDownload(job.id));
    },
    [dispatch],
  );

  /** Remove a download job + delete any partial files associated with it. */
  const remove = useCallback(
    (job: DownloadJob) => {
      void dispatch(removeDownload(job));
    },
    [dispatch],
  );

  /** Uninstall a fully-downloaded model — wipes the files on disk. */
  const uninstall = useCallback(
    async (modelId: string) => {
      try {
        await fetch('/api/model-manager/download', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modelId }),
        });
      } catch {
        // Best-effort cleanup
      }
      dispatch(setModelStatus({ modelId, status: 'not_installed' }));
    },
    [dispatch],
  );

  return { start, retry, cancel, remove, uninstall };
}
