/**
 * The training form's pure data shape — no store, no React, no sidecar
 * wire format. Lives in services (not the store) so request-building code
 * can depend on it without a services→store import; the store's
 * `training-config/types.ts` re-exports everything here and aliases
 * `FormState` to {@link TrainingFormValues} for its existing consumers.
 */

import type { CaptionMode } from '@/app/store/project/types';

import type { CaptionEmission } from './caption-emission';
import type { SampleAspect } from './sample-sizes';
import type { ModelPaths, TrainingProvider } from './types';

export type DatasetSource = {
  projectName: string;
  folderName: string;
  thumbnail?: boolean;
  thumbnailVersion?: number;
  /**
   * Image sizes found on disk, per folder — `{ Root: { '1024x1024': 12 } }`.
   * Keyed by the same folder names as `folders` so the previews can count only
   * the folders a run will actually train on. Derived; absent until scanned.
   */
  folderHistograms?: Record<string, Record<string, number>>;
  /**
   * Which half of a hybrid caption this dataset trains on, or null/absent to
   * follow the selected model's preference.
   *
   * An override rather than a value, for the same reason as `overrideRepeats`:
   * a stored concrete emission goes stale the moment the model changes, and
   * would quietly keep training the tag half into a model that wants prose.
   * Only ever set for hybrid projects — see `services/training/caption-emission`.
   */
  captionEmission?: CaptionEmission | null;
  /**
   * What the last disk rescan found for this folder. Derived from disk and
   * never persisted (see `stripDerived`); absent until a scan has run.
   */
  scan?: DatasetScan;
  folders: DatasetFolder[];
};

type DatasetScan = {
  /** Whether the project folder still exists under the projects root. */
  exists: boolean;
  /** Assets found on disk, across the root and any repeat subfolders. */
  assetCount: number;
  /**
   * The project's caption mode as of this scan. Lives here rather than on the
   * dataset because it is a reading of the tagging project, not a training
   * choice — a config saved today must not keep asserting `hybrid` after the
   * project has been retagged. Being inside `scan` is what makes it derived:
   * `stripDerived` drops the whole field on save.
   */
  captionMode?: CaptionMode;
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

/**
 * One trainable folder: the project root, or a `{n}_label` repeat subdirectory.
 *
 * `name` identifies it and the rest of the fields are the user's choices, but
 * `imageCount` and `detectedRepeats` are readings of the disk — the count of
 * what's in the folder, and the repeat prefix parsed off its name. Both are
 * stripped on save and re-derived on load (see `stripDerived` and
 * `reconcileDatasetFolders`); persisting them means a config keeps asserting
 * yesterday's folder after images are added, removed, or the folder is renamed
 * from `5_x` to `10_x` — which silently trains at the wrong weight.
 */
export type DatasetFolder = {
  name: string;
  imageCount: number;
  detectedRepeats: number;
  overrideRepeats: number | null;
} & FolderAugmentation;

export type ExtraFolder = {
  path: string;
  overrideRepeats: number | null;
} & FolderAugmentation;

export type DurationMode = 'epochs' | 'steps';

export type TrainingFormValues = {
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
  /** Kohya-only, flow-matching models only. */
  discreteFlowShift: number;
  /** Kohya-only, DDPM models only. 0 = disabled. */
  minSnrGamma: number;
  /** Kohya-only, DDPM models only. 0 = disabled. */
  noiseOffset: number;
  /** ai-toolkit-only. Only meaningful when `ema` is enabled. */
  emaDecay: number;

  networkType: 'lora' | 'lokr';
  networkDim: number;
  networkAlpha: number;
  networkDimAlphaLinked: boolean;
  networkDropout: number;
  /** Kohya-only. 0 = disabled. */
  scaleWeightNorms: number;

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
  /** Kohya-only. Only meaningful when multi-resolution bucketing is on. */
  bucketResoSteps: number;
  /** Kohya-only. Only meaningful when multi-resolution bucketing is on. */
  bucketNoUpscale: boolean;
  /** Kohya-only. Exact `WxH` training size, e.g. `'1280x768'`. Empty = off. */
  nativeResolution: string;

  samplingEnabled: boolean;
  samplePrompts: string[];
  /**
   * Per-prompt image shape, index-aligned with `samplePrompts`. Saved configs
   * predating this field load short (or absent) — read it with a
   * `?? DEFAULT_SAMPLE_ASPECT` fallback rather than by index alone.
   */
  samplePromptSizes: SampleAspect[];
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

  // --- Expert tier ---
  /** Kohya-only. Raw --network_args key=value pairs, space-separated. */
  networkArgs: string;
  /** Kohya-only. Raw --optimizer_args key=value pairs, space-separated. */
  optimizerArgs: string;
  /** Kohya-only (anima). Transformer blocks offloaded to CPU. 0 = disabled. */
  blocksToSwap: number;
  /** ai-toolkit-only. LoKr factor; only meaningful when networkType is lokr. */
  lokrFactor: number;
  /** ai-toolkit-only. Bias training toward content vs style. */
  contentOrStyle: 'balanced' | 'content' | 'style';
  /** ai-toolkit-only. Differential output preservation. */
  diffOutputPreservation: boolean;
  /** ai-toolkit-only. DOP multiplier; only meaningful when DOP is enabled. */
  diffOutputPreservationMultiplier: number;
  /** ai-toolkit-only. DOP class word; only meaningful when DOP is enabled. */
  diffOutputPreservationClass: string;
  /** ai-toolkit-only. Comma-separated layer-name substrings to restrict LoRA to. */
  layerTargeting: string;
  /** ai-toolkit-only. Low-VRAM mode. */
  lowVram: boolean;
};
