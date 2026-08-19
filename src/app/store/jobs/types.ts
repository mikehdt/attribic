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
import type { FormState } from '@/app/store/training-config/types';

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

type JobType = 'training' | 'download' | 'tagging';

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
  /**
   * The saved training project the run was launched from, snapshotted at
   * launch so the detail modal can name it. A copy rather than a live lookup:
   * the project can be renamed, re-versioned, or deleted after the run, and
   * the header should say what it was trained from. Absent for ephemeral runs
   * (no project loaded), runs rehydrated from the sidecar, and history entries
   * archived before this field existed.
   *
   * `id` is what the project menu matches its own runs on — it survives a
   * rename, which `name` doesn't. Entries archived before it existed fall back
   * to matching on the name they were saved under.
   */
  project?: { id?: string; name: string; version: number };
  /**
   * The launch form exactly as it was submitted, kept so a past run's settings
   * can be loaded back into the config form. `config` is a lossy summary built
   * for the progress UI (no datasets, single resolution, no expert fields), so
   * it can't serve this. Absent on runs rehydrated from the sidecar and on
   * history entries archived before this field existed — gate reuse on it.
   */
  formSnapshot?: FormState;
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
    /**
     * Transfer rate over the sidecar's trailing window, and the ETA derived
     * from it. Absent for the first second or so of a transfer, and once it
     * has settled.
     */
    speedBps?: number;
    etaSeconds?: number;
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

export type TaggingImageError = {
  fileId: string;
  error: string;
};

export type TaggingSummary = {
  imagesProcessed: number;
  imagesWithNewTags: number;
  totalTagsFound: number;
  /** Number of per-image errors hit during the batch (skipped images). */
  errorCount?: number;
  /**
   * The per-image errors themselves, so the detail view can name the images
   * that were skipped rather than only counting them.
   */
  errors?: TaggingImageError[];
  /**
   * Which kind of tagger ran — determines whether the activity-panel card
   * says "captioned" or "tagged" and whether the summary counts tags.
   */
  providerType?: 'onnx' | 'vlm';
};

/**
 * The most recent per-image result in a batch, kept so the detail view can
 * show an image beside the caption (or tags) it actually produced. Only the
 * latest is retained — the full set is the pending-results store's job, and
 * holding every caption in Redux would duplicate it for no gain.
 */
export type TaggingResult = {
  fileId: string;
  /**
   * File name to render a thumbnail from (`<fileId>.<ext>`, or the sibling
   * poster for video). Absent when there's nothing displayable: reattached
   * batches, whose replay stream doesn't carry it, and videos passed whole to
   * a video-capable model (no poster was extracted). The detail view then
   * shows the result text on its own.
   */
  fileName?: string;
  /** VLM captioner result. */
  caption?: string;
  /** ONNX tagger result. */
  tags?: string[];
};

export type TaggingJob = JobBase & {
  type: 'tagging';
  /** Project folder name (slug from URL) — used for navigation */
  projectFolderName: string;
  /** Project display name — may differ from folder name */
  projectName: string;
  modelName: string;
  /**
   * Which kind of tagger is running. Known from the selected model when the
   * job is created, so the UI can say "captioning" from the outset rather than
   * waiting on `summary.providerType`, which only lands at completion.
   */
  providerType?: 'onnx' | 'vlm';
  progress: TaggingProgress | null;
  summary: TaggingSummary | null;
  lastResult: TaggingResult | null;
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
  /**
   * Which job's detail modal is open, if any. Lives in the slice rather than
   * in the activity panel's own state because it's opened from outside the
   * panel too — starting a batch from the auto-tagger modal hands straight
   * over to the detail view. The type rides along with the id so each detail
   * modal can tell "not my job" from "job's gone".
   */
  detailJob: { id: string; type: 'training' | 'tagging' } | null;
};
