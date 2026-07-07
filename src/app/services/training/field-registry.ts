/**
 * Centralised field registry for the training configuration form.
 * Maps every form field to its expertise tier, conceptual group,
 * and corresponding TrainingDefaults key (for change detection).
 */

import type { TrainingDefaults } from './models';
import { getModelById } from './models';

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
  scheduler: {
    tier: 'simple',
    group: 'learning',
    defaultKey: 'scheduler',
  },
  warmupSteps: {
    tier: 'intermediate',
    group: 'learning',
    defaultKey: 'warmupSteps',
  },
  numRestarts: {
    tier: 'intermediate',
    group: 'learning',
    defaultKey: 'numRestarts',
  },
  weightDecay: {
    tier: 'advanced',
    group: 'learning',
    defaultKey: 'weightDecay',
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
  },
  lossType: {
    tier: 'advanced',
    group: 'learning',
    defaultKey: 'lossType',
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
  },
  networkDropout: {
    tier: 'advanced',
    group: 'loraShape',
    defaultKey: 'networkDropout',
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
  },
  textEncoderQuantization: {
    tier: 'intermediate',
    group: 'performance',
    defaultKey: 'textEncoderQuantization',
  },
  cacheTextEmbeddings: {
    tier: 'intermediate',
    group: 'performance',
    defaultKey: 'cacheTextEmbeddings',
  },
  unloadTextEncoder: {
    tier: 'advanced',
    group: 'performance',
    defaultKey: 'unloadTextEncoder',
  },
  cacheLatents: {
    tier: 'simple',
    group: 'performance',
    defaultKey: 'cacheLatents',
  },
  resolution: {
    tier: 'intermediate',
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
  seed: { tier: 'simple', group: 'sampling', defaultKey: null },
  guidanceScale: {
    tier: 'advanced',
    group: 'sampling',
    defaultKey: 'guidanceScale',
  },
  noiseScheduler: {
    tier: 'advanced',
    group: 'sampling',
    defaultKey: 'noiseScheduler',
  },

  // Saving
  saveFormat: {
    tier: 'simple',
    group: 'saving',
    defaultKey: 'saveFormat',
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

/** Get the set of visible field names for a given tier and model. */
export function getVisibleFields(
  tier: ExpertiseTier,
  modelId: string,
): Set<string> {
  const model = getModelById(modelId);
  const hiddenByModel = new Set(model?.hiddenFields ?? []);

  const visible = new Set<string>();
  for (const [field, meta] of Object.entries(FIELD_REGISTRY)) {
    if (!isTierAtLeast(tier, meta.tier)) continue;
    if (meta.defaultKey && hiddenByModel.has(meta.defaultKey)) continue;
    visible.add(field);
  }
  return visible;
}
