/**
 * Centralised field registry for the training configuration form.
 * Maps every form field to its expertise tier, conceptual group,
 * and corresponding TrainingDefaults key (for change detection).
 */

import type { TrainingDefaults } from './models';
import { getModelById } from './models';
import type { TrainingProvider } from './types';

export type ExpertiseTier = 'simple' | 'intermediate' | 'advanced' | 'expert';

type ConceptualGroup =
  | 'whatToTrain'
  | 'dataset'
  | 'learning'
  | 'loraShape'
  | 'performance'
  | 'sampling'
  | 'saving';

type FieldMeta = {
  tier: ExpertiseTier;
  group: ConceptualGroup;
  /** Key on TrainingDefaults to compare against (null for fields with no model default) */
  defaultKey: keyof TrainingDefaults | null;
  /**
   * Providers that actually consume this field. Absent means the field is
   * shared by all providers. `mock` always sees every field regardless of
   * this list, since it's a fake backend used for UI testing.
   */
  providers?: TrainingProvider[];
};

/**
 * Every form field mapped to its tier, group, and default key.
 *
 * Simple tier: enough to start a training run with good defaults.
 * Intermediate tier: tune behaviour, interactive controls.
 * Advanced tier: full control for experienced users.
 * Expert tier: future (block weights etc).
 *
 * Note: optimizer and scheduler are Simple tier but render as read-only info
 * in Simple mode, becoming interactive dropdowns in Intermediate+. This is
 * handled by the section components, not the registry.
 */
export const FIELD_REGISTRY: Record<string, FieldMeta> = {
  // What to Train
  modelId: { tier: 'simple', group: 'whatToTrain', defaultKey: null },
  modelPaths: { tier: 'simple', group: 'whatToTrain', defaultKey: null },
  outputName: { tier: 'simple', group: 'saving', defaultKey: null },
  datasets: { tier: 'simple', group: 'dataset', defaultKey: null },
  extraFolders: { tier: 'intermediate', group: 'dataset', defaultKey: null },

  // Learning
  durationMode: { tier: 'simple', group: 'learning', defaultKey: null },
  epochs: { tier: 'simple', group: 'learning', defaultKey: 'epochs' },
  steps: { tier: 'simple', group: 'learning', defaultKey: 'steps' },
  learningRate: {
    tier: 'simple',
    group: 'learning',
    defaultKey: 'learningRate',
  },
  // Shown as read-only info in Simple, interactive in Intermediate+
  optimizer: {
    tier: 'simple',
    group: 'learning',
    defaultKey: 'optimizer',
  },
  seed: {
    tier: 'simple',
    group: 'learning',
    defaultKey: null,
  },
  scheduler: {
    tier: 'simple',
    group: 'learning',
    defaultKey: 'scheduler',
    providers: ['kohya'],
  },
  warmupSteps: {
    tier: 'intermediate',
    group: 'learning',
    defaultKey: 'warmupSteps',
    providers: ['kohya'],
  },
  numRestarts: {
    tier: 'intermediate',
    group: 'learning',
    defaultKey: 'numRestarts',
    providers: ['kohya'],
  },
  weightDecay: {
    tier: 'advanced',
    group: 'learning',
    defaultKey: 'weightDecay',
    providers: ['kohya'],
  },
  maxGradNorm: {
    tier: 'advanced',
    group: 'learning',
    defaultKey: 'maxGradNorm',
  },
  trainTextEncoder: {
    tier: 'advanced',
    group: 'learning',
    defaultKey: 'trainTextEncoder',
  },
  backboneLR: {
    tier: 'advanced',
    group: 'learning',
    defaultKey: 'backboneLR',
    providers: ['ai-toolkit'],
  },
  textEncoderLR: {
    tier: 'advanced',
    group: 'learning',
    defaultKey: 'textEncoderLR',
  },
  ema: {
    tier: 'advanced',
    group: 'learning',
    defaultKey: 'ema',
    providers: ['ai-toolkit'],
  },
  lossType: {
    tier: 'advanced',
    group: 'learning',
    defaultKey: 'lossType',
    providers: ['ai-toolkit'],
  },
  timestepType: {
    tier: 'advanced',
    group: 'learning',
    defaultKey: 'timestepType',
  },
  timestepBias: {
    tier: 'advanced',
    group: 'learning',
    defaultKey: 'timestepBias',
    providers: ['ai-toolkit'],
  },
  discreteFlowShift: {
    tier: 'advanced',
    group: 'learning',
    defaultKey: 'discreteFlowShift',
    providers: ['kohya'],
  },
  minSnrGamma: {
    tier: 'advanced',
    group: 'learning',
    defaultKey: 'minSnrGamma',
    providers: ['kohya'],
  },
  noiseOffset: {
    tier: 'advanced',
    group: 'learning',
    defaultKey: 'noiseOffset',
    providers: ['kohya'],
  },
  emaDecay: {
    tier: 'advanced',
    group: 'learning',
    defaultKey: 'emaDecay',
    providers: ['ai-toolkit'],
  },
  // Expert
  optimizerArgs: {
    tier: 'expert',
    group: 'learning',
    defaultKey: 'optimizerArgs',
    providers: ['kohya'],
  },
  contentOrStyle: {
    tier: 'expert',
    group: 'learning',
    defaultKey: 'contentOrStyle',
    providers: ['ai-toolkit'],
  },
  diffOutputPreservation: {
    tier: 'expert',
    group: 'learning',
    defaultKey: 'diffOutputPreservation',
    providers: ['ai-toolkit'],
  },
  diffOutputPreservationMultiplier: {
    tier: 'expert',
    group: 'learning',
    defaultKey: 'diffOutputPreservationMultiplier',
    providers: ['ai-toolkit'],
  },
  diffOutputPreservationClass: {
    tier: 'expert',
    group: 'learning',
    defaultKey: 'diffOutputPreservationClass',
    providers: ['ai-toolkit'],
  },

  // LoRA Shape
  networkDim: {
    tier: 'intermediate',
    group: 'loraShape',
    defaultKey: 'networkDim',
  },
  networkAlpha: {
    tier: 'intermediate',
    group: 'loraShape',
    defaultKey: 'networkAlpha',
  },
  // UI-only preference: does not affect training config, but lives in form
  // state so it persists alongside user edits.
  networkDimAlphaLinked: {
    tier: 'intermediate',
    group: 'loraShape',
    defaultKey: null,
  },
  networkType: {
    tier: 'intermediate',
    group: 'loraShape',
    defaultKey: null,
    providers: ['ai-toolkit'],
  },
  networkDropout: {
    tier: 'advanced',
    group: 'loraShape',
    defaultKey: 'networkDropout',
  },
  scaleWeightNorms: {
    tier: 'advanced',
    group: 'loraShape',
    defaultKey: 'scaleWeightNorms',
    providers: ['kohya'],
  },
  // Expert
  networkArgs: {
    tier: 'expert',
    group: 'loraShape',
    defaultKey: 'networkArgs',
    providers: ['kohya'],
  },
  lokrFactor: {
    tier: 'expert',
    group: 'loraShape',
    defaultKey: 'lokrFactor',
    providers: ['ai-toolkit'],
  },
  layerTargeting: {
    tier: 'expert',
    group: 'loraShape',
    defaultKey: 'layerTargeting',
    providers: ['ai-toolkit'],
  },

  // Performance
  batchSize: {
    tier: 'simple',
    group: 'learning',
    defaultKey: 'batchSize',
  },
  mixedPrecision: {
    tier: 'simple',
    group: 'performance',
    defaultKey: 'mixedPrecision',
  },
  transformerQuantization: {
    tier: 'intermediate',
    group: 'performance',
    defaultKey: 'transformerQuantization',
    providers: ['ai-toolkit'],
  },
  textEncoderQuantization: {
    tier: 'intermediate',
    group: 'performance',
    defaultKey: 'textEncoderQuantization',
    providers: ['ai-toolkit'],
  },
  cacheTextEmbeddings: {
    tier: 'intermediate',
    group: 'performance',
    defaultKey: 'cacheTextEmbeddings',
    providers: ['ai-toolkit'],
  },
  unloadTextEncoder: {
    tier: 'advanced',
    group: 'performance',
    defaultKey: 'unloadTextEncoder',
    providers: ['ai-toolkit'],
  },
  cacheLatents: {
    tier: 'advanced',
    group: 'performance',
    defaultKey: 'cacheLatents',
    providers: ['kohya'],
  },
  resolution: {
    tier: 'simple',
    group: 'performance',
    defaultKey: 'resolution',
  },
  gradientAccumulationSteps: {
    tier: 'advanced',
    group: 'performance',
    defaultKey: 'gradientAccumulationSteps',
  },
  gradientCheckpointing: {
    tier: 'advanced',
    group: 'performance',
    defaultKey: 'gradientCheckpointing',
    providers: ['kohya'],
  },
  bucketResoSteps: {
    tier: 'advanced',
    group: 'performance',
    defaultKey: 'bucketResoSteps',
    providers: ['kohya'],
  },
  bucketNoUpscale: {
    tier: 'advanced',
    group: 'performance',
    defaultKey: 'bucketNoUpscale',
    providers: ['kohya'],
  },
  // Expert
  blocksToSwap: {
    tier: 'expert',
    group: 'performance',
    defaultKey: 'blocksToSwap',
    providers: ['kohya'],
  },
  lowVram: {
    tier: 'expert',
    group: 'performance',
    defaultKey: 'lowVram',
    providers: ['ai-toolkit'],
  },
  // Per-folder augmentation (captionShuffling, captionDropoutRate,
  // keepTokens, flipAugment, flipVAugment) lives on DatasetFolder itself,
  // not as top-level form state — see FolderAugmentation in the form hook.

  // Sampling
  samplingEnabled: {
    tier: 'intermediate',
    group: 'sampling',
    defaultKey: null,
  },
  samplePrompts: {
    tier: 'intermediate',
    group: 'sampling',
    defaultKey: null,
  },
  sampleMode: { tier: 'intermediate', group: 'sampling', defaultKey: null },
  sampleEveryEpochs: {
    tier: 'intermediate',
    group: 'sampling',
    defaultKey: null,
  },
  sampleEverySteps: {
    tier: 'intermediate',
    group: 'sampling',
    defaultKey: null,
  },
  sampleSteps: {
    tier: 'intermediate',
    group: 'sampling',
    defaultKey: 'sampleSteps',
  },
  guidanceScale: {
    tier: 'advanced',
    group: 'sampling',
    defaultKey: 'guidanceScale',
  },
  sampleSampler: {
    tier: 'advanced',
    group: 'sampling',
    defaultKey: 'sampleSampler',
  },

  // Saving
  saveFormat: {
    tier: 'intermediate',
    group: 'saving',
    defaultKey: 'saveFormat',
    providers: ['kohya'],
  },
  saveEnabled: { tier: 'simple', group: 'saving', defaultKey: null },
  saveMode: { tier: 'simple', group: 'saving', defaultKey: null },
  saveEveryEpochs: { tier: 'simple', group: 'saving', defaultKey: null },
  saveEverySteps: { tier: 'simple', group: 'saving', defaultKey: null },
  maxSavesToKeep: {
    tier: 'intermediate',
    group: 'saving',
    defaultKey: 'maxSavesToKeep',
  },
  saveState: { tier: 'advanced', group: 'saving', defaultKey: null },
  resumeState: { tier: 'advanced', group: 'saving', defaultKey: null },
};

const TIER_ORDER: ExpertiseTier[] = [
  'simple',
  'intermediate',
  'advanced',
  'expert',
];

/** Check if `current` tier is at least as high as `required`. */
export function isTierAtLeast(
  current: ExpertiseTier,
  required: ExpertiseTier,
): boolean {
  return TIER_ORDER.indexOf(current) >= TIER_ORDER.indexOf(required);
}

/** Get the set of visible field names for a given tier, model, and provider. */
export function getVisibleFields(
  tier: ExpertiseTier,
  modelId: string,
  provider: TrainingProvider,
): Set<string> {
  const model = getModelById(modelId);
  const hiddenByModel = new Set(model?.hiddenFields ?? []);

  const visible = new Set<string>();
  for (const [field, meta] of Object.entries(FIELD_REGISTRY)) {
    if (!isTierAtLeast(tier, meta.tier)) continue;
    if (meta.defaultKey && hiddenByModel.has(meta.defaultKey)) continue;
    // Mock is a fake backend for UI testing, so it shows every field
    // regardless of which real provider(s) support it.
    if (
      provider !== 'mock' &&
      meta.providers &&
      !meta.providers.includes(provider)
    ) {
      continue;
    }
    visible.add(field);
  }
  return visible;
}
