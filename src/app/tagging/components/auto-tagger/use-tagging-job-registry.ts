/**
 * Per-job bookkeeping for tagging batches that this hook instance is running.
 *
 * Everything here is keyed by job id rather than held in a single slot: this
 * hook survives navigation and the sidecar queues batches, so two batches can
 * be streaming at once, and a single slot would build one job's summary out of
 * the other's state.
 *
 * The registry object is created once per hook instance and never replaced, so
 * it is safe to name in a dependency array.
 */

import { useState } from 'react';

import {
  registerTaggingController,
  removeTaggingController,
} from '@/app/services/auto-tagger/tagging-controllers';

type TaggingImageError = { fileId: string; error: string };

export type TaggingJobRegistry = {
  /**
   * Claim a job id: register its abort controller and open its error bucket.
   * The returned controller's signal is retained here so it stays queryable
   * after `abortTagging` drops the controller from the controllers module —
   * it's the only truthful per-job "was this cancelled locally?".
   */
  registerJob: (
    jobId: string,
    providerType?: 'vlm' | 'onnx',
  ) => AbortController;
  /** Drop every trace of a job once its stream has ended. */
  releaseJob: (jobId: string) => void;
  /** Per-image errors collected during a run, for that job's summary. */
  recordImageError: (jobId: string, error: TaggingImageError) => void;
  getImageErrors: (jobId: string) => TaggingImageError[];
  /**
   * The provider that actually ran a job. The current *selection* isn't it: a
   * reattached batch ran before this session's selection existed, and the user
   * can change the selector while a batch streams.
   */
  getProviderType: (jobId: string) => 'vlm' | 'onnx' | undefined;
  isJobAborted: (jobId: string) => boolean;
  /**
   * Consecutive failures to attach to a batch, per batch id. Bounds the
   * sweep's retries so a batch that can never be attached stops re-failing.
   */
  getAttachFailures: (jobId: string) => number;
  countAttachFailure: (jobId: string) => void;
  clearAttachFailures: (jobId: string) => void;
};

function createTaggingJobRegistry(): TaggingJobRegistry {
  const imageErrors = new Map<string, TaggingImageError[]>();
  const jobProviderTypes = new Map<string, 'vlm' | 'onnx'>();
  const jobAbortSignals = new Map<string, AbortSignal>();
  const attachFailures = new Map<string, number>();

  return {
    registerJob(jobId, providerType) {
      const abortController = registerTaggingController(jobId);
      jobAbortSignals.set(jobId, abortController.signal);
      imageErrors.set(jobId, []);
      if (providerType) {
        jobProviderTypes.set(jobId, providerType);
      }
      return abortController;
    },
    releaseJob(jobId) {
      removeTaggingController(jobId);
      jobAbortSignals.delete(jobId);
      imageErrors.delete(jobId);
      jobProviderTypes.delete(jobId);
    },
    recordImageError(jobId, error) {
      imageErrors.get(jobId)?.push(error);
    },
    getImageErrors(jobId) {
      return imageErrors.get(jobId) ?? [];
    },
    getProviderType(jobId) {
      return jobProviderTypes.get(jobId);
    },
    isJobAborted(jobId) {
      return jobAbortSignals.get(jobId)?.aborted === true;
    },
    getAttachFailures(jobId) {
      return attachFailures.get(jobId) ?? 0;
    },
    countAttachFailure(jobId) {
      attachFailures.set(jobId, (attachFailures.get(jobId) ?? 0) + 1);
    },
    clearAttachFailures(jobId) {
      attachFailures.delete(jobId);
    },
  };
}

export function useTaggingJobRegistry(): TaggingJobRegistry {
  // Lazy initial state rather than a ref: the object is built once and never
  // replaced, and reading it during render is exactly what a ref may not do.
  const [registry] = useState(createTaggingJobRegistry);
  return registry;
}
