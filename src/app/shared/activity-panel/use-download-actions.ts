/**
 * Shared download lifecycle handlers — start, retry, cancel, delete partial,
 * and uninstall a fully-downloaded model.
 *
 * Used by the activity panel cards and by the in-modal rows in the
 * Model Manager so both surfaces share the same logic and side effects.
 *
 * Auto-tagger slice mirroring is handled by middleware on setModelStatus,
 * so callers here only need to dispatch model-manager updates.
 */

import { useCallback } from 'react';

import { abortDownload } from '@/app/services/model-manager/download-controllers';
import { startModelDownload } from '@/app/services/model-manager/start-download';
import type {
  DownloadableModel,
  ModelVariant,
} from '@/app/services/model-manager/types';
import { useAppDispatch, useAppStore } from '@/app/store/hooks';
import { type DownloadJob, removeJob, updateJobStatus } from '@/app/store/jobs';
import { setModelStatus } from '@/app/store/model-manager';

export function useDownloadActions() {
  const dispatch = useAppDispatch();
  const store = useAppStore();

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
      startModelDownload({
        modelId: model.id,
        modelName: model.name,
        variantId: variant?.id,
        dispatch,
        getState: store.getState,
      });
    },
    [dispatch, store],
  );

  const retry = useCallback(
    (job: DownloadJob) => {
      dispatch(removeJob(job.id));
      startModelDownload({
        modelId: job.modelId,
        modelName: job.modelName,
        dispatch,
        getState: store.getState,
      });
    },
    [dispatch, store],
  );

  const cancel = useCallback(
    (job: DownloadJob) => {
      abortDownload(job.id);
      dispatch(
        updateJobStatus({
          id: job.id,
          status: 'cancelled',
          error: 'Download cancelled',
        }),
      );
      dispatch(
        setModelStatus({ modelId: job.modelId, status: 'not_installed' }),
      );
    },
    [dispatch],
  );

  /** Remove a download job + delete any partial files associated with it. */
  const remove = useCallback(
    async (job: DownloadJob) => {
      try {
        await fetch('/api/model-manager/download', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modelId: job.modelId }),
        });
      } catch {
        // Best-effort cleanup
      }
      dispatch(removeJob(job.id));
      dispatch(
        setModelStatus({ modelId: job.modelId, status: 'not_installed' }),
      );
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
