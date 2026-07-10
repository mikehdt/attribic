import type { ModelComponentType } from '@/app/services/training/models';
import type { TrainingProvider } from '@/app/services/training/types';

export type DatasetSource = {
  projectName: string;
  folderName: string;
  thumbnail?: string;
  thumbnailVersion?: number;
  dimensionHistogram?: Record<string, number>;
  folders: DatasetFolder[];
};

export type FolderAugmentation = {
  captionShuffling: boolean;
  captionDropoutRate: number;
  keepTokens: number;
  flipAugment: boolean;
  flipVAugment: boolean;
  loraWeight: number;
  isRegularization: boolean;
};

export type DatasetFolder = {
  name: string;
  imageCount: number;
  detectedRepeats: number;
  overrideRepeats: number | null;
} & FolderAugmentation;

export type ExtraFolder = {
  path: string;
  imageCount?: number;
  overrideRepeats: number | null;
} & FolderAugmentation;

export type FolderAugmentKey = keyof FolderAugmentation;

export type DurationMode = 'epochs' | 'steps';

export type ModelPaths = Partial<Record<ModelComponentType, string>>;

export type AppModelDefaults = Record<
  string,
  Partial<Record<ModelComponentType, string>>
>;

export type FormState = {
  modelId: string;
  selectedProvider: TrainingProvider;
  modelPaths: ModelPaths;
  outputName: string;

  datasets: DatasetSource[];
  extraFolders: ExtraFolder[];

  durationMode: DurationMode;
  epochs: number;
  steps: number;
  learningRate: number;
  optimizer: string;
  scheduler: string;
  warmupSteps: number;
  numRestarts: number;
  weightDecay: number;
  maxGradNorm: number;
  trainTextEncoder: boolean;
  backboneLR: number;
  textEncoderLR: number;
  ema: boolean;
  lossType: 'mse' | 'huber' | 'smooth_l1';
  timestepType: string;
  timestepBias: 'balanced' | 'earlier' | 'later';

  networkType: 'lora' | 'lokr';
  networkDim: number;
  networkAlpha: number;
  networkDimAlphaLinked: boolean;
  networkDropout: number;

  batchSize: number;
  resolution: number[];
  mixedPrecision: 'bf16' | 'fp16';
  transformerQuantization: 'none' | 'float8';
  textEncoderQuantization: 'none' | 'float8';
  cacheTextEmbeddings: boolean;
  unloadTextEncoder: boolean;
  gradientAccumulationSteps: number;
  gradientCheckpointing: boolean;
  cacheLatents: boolean;

  samplingEnabled: boolean;
  samplePrompts: string[];
  sampleMode: 'epochs' | 'steps';
  sampleEveryEpochs: number;
  sampleEverySteps: number;
  sampleSteps: number;
  seed: number;
  guidanceScale: number;
  sampleSampler: string;

  saveEnabled: boolean;
  saveMode: 'epochs' | 'steps';
  saveEveryEpochs: number;
  saveEverySteps: number;
  saveFormat: 'fp16' | 'bf16' | 'fp32';
  maxSavesToKeep: number;
  saveState: boolean;
  resumeState: string;
};

export type SectionName =
  | 'whatToTrain'
  | 'dataset'
  | 'learning'
  | 'loraShape'
  | 'performance'
  | 'sampling'
  | 'saving';

/** Metadata describing the saved project currently loaded into the form. */
export type LoadedProject = {
  id: string;
  name: string;
  version: number;
  versionLabel: string | null;
  savedAt: string;
};

export type TrainingConfigState = {
  form: FormState;
  appModelDefaults: AppModelDefaults;
  /** Metadata about which saved project/version is loaded, if any. */
  loadedProject: LoadedProject | null;
  /**
   * Snapshot of the form at load/save time. Compared against `form` to
   * compute the dirty flag. Null when ephemeral (nothing to compare against).
   */
  baselineSnapshot: FormState | null;
};
