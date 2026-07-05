/**
 * Types for the unified jobs slice.
 *
 * Every long-running operation (training, download, future generation)
 * is a "job" with typed progress. The activity panel renders all jobs.
 */

import type {
  TrainingJobConfig,
  TrainingProgress,
} from '@/app/services/training/types';

// ---------------------------------------------------------------------------
// Job status (shared across all job types)
// ---------------------------------------------------------------------------

export type JobStatus =
  | 'pending'
  | 'preparing'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

// ---------------------------------------------------------------------------
// Job type discriminator
// ---------------------------------------------------------------------------

export type JobType = 'training' | 'download' | 'tagging';

// ---------------------------------------------------------------------------
// Per-type job shapes
// ---------------------------------------------------------------------------

type JobBase = {
  id: string;
  type: JobType;
  status: JobStatus;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  error: string | null;
};

export type TrainingJob = JobBase & {
  type: 'training';
  config: TrainingJobConfig;
  progress: TrainingProgress | null;
};

export type DownloadJob = JobBase & {
  type: 'download';
  modelId: string;
  modelName: string;
  targetDir: string;
  progress: {
    bytesDownloaded: number;
    totalBytes: number;
    currentFile?: string;
    /** 1-based index of the file currently being processed. */
    fileIndex?: number;
    /** Total number of files in this download. */
    totalFiles?: number;
  } | null;
};

export type TaggingProgress = {
  current: number;
  total: number;
  currentFileId?: string;
  /**
   * Model-loading sub-state. Present only while the backend is still
   * loading weights (VLM sidecar, first call after selecting a model).
   * When set, the UI shows a "Loading model..." panel instead of the
   * image-counter progress bar.
   */
  loading?: {
    message: string;
    current: number;
    total: number;
  };
  /**
   * Queue sub-state. Present while the batch is waiting in the sidecar's
   * job queue behind other GPU work (a training run, another batch).
   * When set, the UI shows "Queued — position N" instead of progress.
   */
  queued?: {
    position: number;
  };
};

export type TaggingSummary = {
  imagesProcessed: number;
  imagesWithNewTags: number;
  totalTagsFound: number;
  /** Number of per-image errors hit during the batch (skipped images). */
  errorCount?: number;
  /**
   * Which kind of tagger ran — determines whether the activity-panel card
   * says "captioned" or "tagged" and whether the summary counts tags.
   */
  providerType?: 'onnx' | 'vlm';
};

export type TaggingJob = JobBase & {
  type: 'tagging';
  /** Project folder name (slug from URL) — used for navigation */
  projectFolderName: string;
  /** Project display name — may differ from folder name */
  projectName: string;
  modelName: string;
  progress: TaggingProgress | null;
  summary: TaggingSummary | null;
};

export type Job = TrainingJob | DownloadJob | TaggingJob;

// ---------------------------------------------------------------------------
// Slice state
// ---------------------------------------------------------------------------

export type JobsState = {
  /** All jobs keyed by ID */
  jobs: Record<string, Job>;
  /** Activity panel visibility */
  panelOpen: boolean;
};
