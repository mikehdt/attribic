import type { ModelComponentType } from './models';

// --- Provider & Backend ---

export type TrainingProvider = 'ai-toolkit' | 'kohya' | 'musubi' | 'mock';

export const TRAINING_PROVIDER_LABELS: Record<TrainingProvider, string> = {
  'ai-toolkit': 'AI Toolkit (Ostris)',
  kohya: 'SD Scripts (Kohya)',
  musubi: 'Musubi Tuner (Kohya)',
  mock: 'Mock (fake GPU, UI testing)',
};

// --- Job Lifecycle ---

export type TrainingJobStatus =
  'pending' | 'preparing' | 'training' | 'completed' | 'failed' | 'cancelled';

// --- Sidecar ---

export type SidecarStatus = 'stopped' | 'starting' | 'ready' | 'error';

// --- Progress (received via WebSocket) ---

/** One sampled point in the loss-over-steps series. */
export type LossPoint = { step: number; loss: number };

/**
 * One sampled point in the speed-over-steps series. Always seconds-per-iteration
 * (the sidecar normalises the trainer's it/s or s/it rate), sampled at the same
 * downsampled steps as {@link LossPoint} so the two curves share an x-axis.
 */
export type SpeedPoint = { step: number; secPerIt: number };

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
  learningRate: number | null;
  etaSeconds: number | null;
  sampleImagePaths: string[];
  /** Predicted checkpoint step positions derived from the save cadence. */
  checkpointSteps: number[];
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
};

// --- Hyperparameters ---

export type TrainingHyperparameters = {
  learningRate: number;
  epochs: number;
  batchSize: number;
  resolution: number;
  networkDim: number; // LoRA rank
  networkAlpha: number; // LoRA alpha
  optimizer: string; // e.g. 'adamw8bit', 'prodigy'
  scheduler: string; // e.g. 'cosine', 'constant'
  warmupSteps: number;
  saveEveryNEpochs: number;
  sampleEveryNSteps: number;
  gradientAccumulationSteps: number;
  mixedPrecision: 'fp16' | 'bf16';
  extra: Record<string, unknown>; // Provider-specific extras
};

// --- Dataset ---

export type TrainingDataset = {
  path: string;
  numRepeats: number;
};

// --- Job Configuration ---

export type ModelPaths = Partial<Record<ModelComponentType, string>>;

export type TrainingJobConfig = {
  projectPath: string;
  provider: TrainingProvider;
  baseModel: string;
  modelPaths: ModelPaths;
  outputPath: string;
  outputName: string;
  datasets: TrainingDataset[];
  hyperparameters: TrainingHyperparameters;
  samplePrompts: string[];
};

// --- Per-Project Settings (stored in project config JSON) ---

export type TrainingSettings = {
  datasets?: TrainingDataset[];
  provider?: TrainingProvider;
  baseModel?: string;
  outputPath?: string;
  outputName?: string;
  hyperparameters?: Partial<TrainingHyperparameters>;
  samplePrompts?: string[];
  lastPreset?: string;
};
