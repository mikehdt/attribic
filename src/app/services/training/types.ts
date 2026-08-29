import type { ModelComponentType } from './models';

// --- Provider & Backend ---

export type TrainingProvider =
  | 'ai-toolkit'
  | 'kohya'
  | 'musubi'
  | 'fizgig'
  | 'mock';

export const TRAINING_PROVIDER_LABELS: Record<TrainingProvider, string> = {
  'ai-toolkit': 'AI Toolkit (Ostris)',
  kohya: 'SD Scripts (Kohya)',
  musubi: 'Musubi Tuner (Kohya)',
  fizgig: 'Fizgig (experimental)',
  mock: 'Mock (fake GPU, UI testing)',
};

/** Compact backend names for tight UI (badges, list rows, group titles). */
export const TRAINING_PROVIDER_SHORT_LABELS: Record<TrainingProvider, string> =
  {
    'ai-toolkit': 'AI Toolkit',
    kohya: 'SD Scripts',
    musubi: 'Musubi',
    fizgig: 'Fizgig',
    mock: 'Mock',
  };

// --- Job Lifecycle ---

export type TrainingJobStatus =
  'pending' | 'preparing' | 'training' | 'completed' | 'failed' | 'cancelled';

// --- Progress (received via WebSocket) ---

/** One sampled point in the loss-over-steps series. */
export type LossPoint = { step: number; loss: number };

/**
 * One sampled point in the speed-over-steps series. Always seconds-per-iteration
 * (the sidecar normalises the trainer's it/s or s/it rate), sampled at the same
 * downsampled steps as {@link LossPoint} so the two curves share an x-axis.
 */
export type SpeedPoint = { step: number; secPerIt: number };

/**
 * One training-time sample image discovered on disk by the sidecar. Path is
 * relative to the loras root (POSIX separators) so the client resolves it
 * against the samples serving route without any path math. Step and prompt
 * index come from the filename; epoch is only set for Kohya epoch-cadence runs.
 *
 * `path` normally points into the run's archive folder — the sidecar copies
 * each sample there as soon as it sees it — with `sourcePath` holding the
 * trainer's original so the archive route can sweep it once the run ends. When
 * the copy couldn't be made, `path` is the original and `sourcePath` is null.
 */
export type SampleImage = {
  path: string;
  step: number;
  epoch: number | null;
  promptIndex: number;
  sourcePath?: string | null;
};

/**
 * Diffusion-step progress of the sample image the trainer is rendering right
 * now (Kohya's own sampler bar). Present only during a sampling pause, and only
 * for backends whose logs expose it — ai-toolkit reports the image count within
 * the event but no per-image bar, so it stays null there.
 */
export type SampleProgress = { current: number; total: number };

export type TrainingProgress = {
  jobId: string;
  status: TrainingJobStatus;
  startedAt: number;
  completedAt: number | null;
  currentStep: number;
  totalSteps: number;
  currentEpoch: number;
  totalEpochs: number;
  loss: number | null;
  /**
   * Downsampled {step, loss} series accumulated sidecar-side; survives page
   * refresh via the sidecar's persisted job state.
   */
  lossHistory: LossPoint[];
  /**
   * Downsampled seconds-per-iteration series, sampled at the same steps as
   * {@link lossHistory}. Empty for backends that don't report a rate. Drives
   * the speed graph in the expanded training detail view.
   */
  speedHistory: SpeedPoint[];
  /**
   * Transient seconds-per-iteration series for the current setup phase
   * (caching latents / text-encoder outputs). Populated only while preparing
   * and discarded once training starts — drives the speed graph during
   * caching, kept separate from {@link speedHistory} so it never pollutes the
   * training curve.
   */
  prepSpeedHistory: SpeedPoint[];
  learningRate: number | null;
  etaSeconds: number | null;
  samples: SampleImage[];
  /** Predicted checkpoint step positions derived from the save cadence. */
  checkpointSteps: number[];
  /**
   * Predicted sample-generation step positions derived from the sampling
   * cadence; empty when sampling is off. Unrelated to the `sampleSteps`
   * hyperparameter (inference steps per sample image).
   */
  sampleSteps: number[];
  /** Steps at which the trainer confirmed a checkpoint was actually written. */
  savedCheckpoints: number[];
  logLines: string[];
  error: string | null;
  /**
   * Human-readable activity label. While preparing it names the setup phase
   * (e.g. "Caching latents") and currentStep/totalSteps carry that phase's own
   * item count; while training it names a transient activity between steps
   * (e.g. "Saving checkpoint"), or is null while steps advance.
   */
  phase: string | null;
  /** Iteration rate from the trainer, e.g. "2.30 it/s" / "23.01 s/it". */
  speed: string | null;
  /**
   * Progress through the sample image being rendered right now; null whenever
   * the trainer isn't sampling or the backend doesn't report it (the samples
   * grid then falls back to an indeterminate bar).
   */
  sampleProgress: SampleProgress | null;
  /**
   * Cumulative seconds spent actively training, accumulated sidecar-side from
   * the gaps between training ticks. Excludes queueing/preparing and, unlike
   * the wall-clock {@link startedAt}→{@link completedAt} span, carries across a
   * stop→resume. Advances on the ~1/sec progress ticks (no client interval
   * needed). 0 until the first training step.
   */
  trainingSeconds: number;
};

// --- Hyperparameters ---

/**
 * The headline hyperparameters the activity panel and run-history actually
 * render — a summary, not a full record of the launch config. Deliberately
 * narrower than the launch form: this type previously carried
 * form-shaped fields (`resolution`, `batchSize`, `networkAlpha`, `optimizer`,
 * `saveEveryNEpochs`, `sampleEveryNSteps`, `gradientAccumulationSteps`,
 * `mixedPrecision`) that nothing ever read back, so `snapshotClientConfig`
 * and `trainingJobFromSidecar` (training-runtime.ts) were fabricating
 * plausible-looking values for them — `resolution` in particular collapsing
 * a list down to one entry, and readback filling in constants (1024, 1, 250,
 * 'bf16') that had nothing to do with the run. If a consumer starts reading
 * one of those again, add it back deliberately, sourced truthfully — don't
 * resurrect a fabricated placeholder.
 */
type TrainingHyperparameters = {
  learningRate: number;
  epochs: number;
  networkDim: number; // LoRA rank
  scheduler: string; // e.g. 'cosine', 'constant'
  warmupSteps: number;
  extra: Record<string, unknown>; // Provider-specific extras (numRestarts, maxSavesToKeep, ...)
};

// --- Job Configuration ---

export type ModelPaths = Partial<Record<ModelComponentType, string>>;

/**
 * Client-owned summary of a launched run, snapshotted at launch time and
 * stored verbatim on the sidecar's job record (`client_config`) so a run
 * redisplays exactly as it did live, including after a page reload or a
 * sidecar restart. It is a *display* summary for the activity panel and run
 * history, not a rebuildable launch config — {@link FormState} in
 * `store/training-config/types.ts` is what `formSnapshot` carries for that.
 *
 * Only fields an activity-panel/run-history consumer actually reads belong
 * here (see the {@link TrainingHyperparameters} comment) — this list, not the
 * launch form, is the contract. `datasets`, `projectPath`, `baseModel`,
 * `modelPaths` and `outputPath` were removed for the same reason: nothing
 * read them, and `datasets` was always populated with `[]` regardless of the
 * run's actual dataset list.
 *
 * Sidecar job records written before this narrowing still have the wider
 * JSON shape on disk — `client_config` round-trips through
 * `fetchJson`/`JSON.parse` with no runtime validation, so the extra fields
 * simply ride along unread rather than breaking anything (see
 * `trainingJobFromSidecar` in training-runtime.ts).
 */
export type TrainingJobConfig = {
  provider: TrainingProvider;
  outputName: string;
  hyperparameters: TrainingHyperparameters;
  samplePrompts: string[];
};
