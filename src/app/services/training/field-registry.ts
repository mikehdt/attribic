/**
 * Centralised field registry for the training configuration form.
 * Maps every form field to its expertise tier, conceptual group,
 * and corresponding TrainingDefaults key (for change detection).
 */

import type { TrainingDefaults } from './models';
import { getModelById } from './models';
import type { ProviderCapability } from './provider-capabilities';
import { hasCapability } from './provider-capabilities';
import type { TrainingProvider } from './types';

export type ExpertiseTier = 'simple' | 'intermediate' | 'advanced' | 'expert';

/**
 * The form's conceptual sections. Each maps to one collapsible section in the
 * UI, and is the unit that per-section reset and change-detection work on
 * (aliased as `SectionName` in the training-config store).
 */
export type ConceptualGroup =
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
   * The capability this field requires. Absent means the field is shared by
   * every provider. `mock`'s capability set is total, so it always sees every
   * field regardless of this.
   */
  capability?: ProviderCapability;
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
/**
 * Identity helper that keeps the registry's keys as literals (so
 * `TrainingFieldName` is the exact field set) while typing every value as
 * `FieldMeta` — a plain `Record<string, FieldMeta>` annotation would widen the
 * keys to `string` and lose that.
 */
const defineFields = <T extends Record<string, FieldMeta>>(
  fields: T,
): { [K in keyof T]: FieldMeta } => fields;

export const FIELD_REGISTRY = defineFields({
  // What to Train
  modelId: { tier: 'simple', group: 'whatToTrain', defaultKey: null },
  selectedProvider: { tier: 'simple', group: 'whatToTrain', defaultKey: null },
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
    capability: 'lrSchedulerControls',
  },
  warmupSteps: {
    tier: 'intermediate',
    group: 'learning',
    defaultKey: 'warmupSteps',
    capability: 'lrSchedulerControls',
  },
  numRestarts: {
    tier: 'intermediate',
    group: 'learning',
    defaultKey: 'numRestarts',
    capability: 'lrSchedulerControls',
  },
  weightDecay: {
    tier: 'advanced',
    group: 'learning',
    defaultKey: 'weightDecay',
    capability: 'optimizerExtraArgs',
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
    capability: 'backboneLr',
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
    capability: 'ema',
  },
  lossType: {
    tier: 'advanced',
    group: 'learning',
    defaultKey: 'lossType',
    capability: 'lossType',
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
    capability: 'timestepBias',
  },
  discreteFlowShift: {
    tier: 'advanced',
    group: 'learning',
    defaultKey: 'discreteFlowShift',
    capability: 'discreteFlowShift',
  },
  minSnrGamma: {
    tier: 'advanced',
    group: 'learning',
    defaultKey: 'minSnrGamma',
    capability: 'ddpmNoiseControls',
  },
  noiseOffset: {
    tier: 'advanced',
    group: 'learning',
    defaultKey: 'noiseOffset',
    capability: 'ddpmNoiseControls',
  },
  emaDecay: {
    tier: 'advanced',
    group: 'learning',
    defaultKey: 'emaDecay',
    capability: 'ema',
  },
  // Expert
  optimizerArgs: {
    tier: 'expert',
    group: 'learning',
    defaultKey: 'optimizerArgs',
    capability: 'optimizerExtraArgs',
  },
  contentOrStyle: {
    tier: 'expert',
    group: 'learning',
    defaultKey: 'contentOrStyle',
    capability: 'contentOrStyle',
  },
  diffOutputPreservation: {
    tier: 'expert',
    group: 'learning',
    defaultKey: 'diffOutputPreservation',
    capability: 'dop',
  },
  diffOutputPreservationMultiplier: {
    tier: 'expert',
    group: 'learning',
    defaultKey: 'diffOutputPreservationMultiplier',
    capability: 'dop',
  },
  diffOutputPreservationClass: {
    tier: 'expert',
    group: 'learning',
    defaultKey: 'diffOutputPreservationClass',
    capability: 'dop',
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
    capability: 'networkTypeSelect',
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
    capability: 'scaleWeightNorms',
  },
  // Expert
  networkArgs: {
    tier: 'expert',
    group: 'loraShape',
    defaultKey: 'networkArgs',
    capability: 'networkExtraArgs',
  },
  lokrFactor: {
    tier: 'expert',
    group: 'loraShape',
    defaultKey: 'lokrFactor',
    capability: 'lokr',
  },
  layerTargeting: {
    tier: 'expert',
    group: 'loraShape',
    defaultKey: 'layerTargeting',
    capability: 'layerTargeting',
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
    capability: 'quantization',
  },
  textEncoderQuantization: {
    tier: 'intermediate',
    group: 'performance',
    defaultKey: 'textEncoderQuantization',
    capability: 'quantization',
  },
  cacheTextEmbeddings: {
    tier: 'intermediate',
    group: 'performance',
    defaultKey: 'cacheTextEmbeddings',
    capability: 'teCacheToggle',
  },
  unloadTextEncoder: {
    tier: 'advanced',
    group: 'performance',
    defaultKey: 'unloadTextEncoder',
    capability: 'unloadTextEncoder',
  },
  cacheLatents: {
    tier: 'advanced',
    group: 'performance',
    defaultKey: 'cacheLatents',
    capability: 'latentCacheToggle',
  },
  // No capability: every real backend caches latents (and usually text-encoder
  // outputs) to disk, they just disagree about where — see the sidecar's
  // `cache_cleanup` module for the three layouts.
  clearCaches: {
    tier: 'intermediate',
    group: 'performance',
    defaultKey: 'clearCaches',
  },
  resolution: {
    tier: 'simple',
    group: 'performance',
    defaultKey: 'resolution',
  },
  // Simple tier, but renders as read-only text in Simple mode (and only when
  // set) — an exact size materially changes what trains, so hiding it outright
  // would misrepresent the run. Interactive from Intermediate up. Same
  // read-only-in-Simple pattern as optimizer/scheduler above.
  nativeResolution: {
    tier: 'simple',
    group: 'performance',
    defaultKey: 'nativeResolution',
    capability: 'nativeResolution',
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
    capability: 'gradientCheckpointingToggle',
  },
  bucketResoSteps: {
    tier: 'advanced',
    group: 'performance',
    defaultKey: 'bucketResoSteps',
    capability: 'bucketControls',
  },
  bucketNoUpscale: {
    tier: 'advanced',
    group: 'performance',
    defaultKey: 'bucketNoUpscale',
    capability: 'bucketControls',
  },
  layerOffloadPercent: {
    tier: 'advanced',
    group: 'performance',
    defaultKey: 'layerOffloadPercent',
    capability: 'layerOffloading',
  },
  // Expert
  blocksToSwap: {
    tier: 'expert',
    group: 'performance',
    defaultKey: 'blocksToSwap',
    capability: 'blockSwap',
  },
  lowVram: {
    tier: 'expert',
    group: 'performance',
    defaultKey: 'lowVram',
    capability: 'lowVram',
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
  samplePromptSizes: {
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
    capability: 'saveFormat',
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
});

/**
 * Every field the form knows about. Kept in step with `FormState` by a
 * compile-time check in the training-config store — the registry is the single
 * source of truth for which section a field belongs to, so a field missing
 * from it silently drops out of per-section reset and change detection.
 */
export type TrainingFieldName = keyof typeof FIELD_REGISTRY;

const SECTION_FIELDS = (() => {
  const bySection = {} as Record<ConceptualGroup, TrainingFieldName[]>;
  for (const [field, meta] of Object.entries(FIELD_REGISTRY)) {
    (bySection[meta.group] ??= []).push(field as TrainingFieldName);
  }
  return bySection;
})();

/** The fields belonging to one form section, in registry order. */
export function getSectionFields(
  section: ConceptualGroup,
): readonly TrainingFieldName[] {
  return SECTION_FIELDS[section] ?? [];
}

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
): Set<TrainingFieldName> {
  const model = getModelById(modelId);
  const hiddenByModel = new Set(model?.hiddenFields ?? []);

  const visible = new Set<TrainingFieldName>();
  for (const [field, meta] of Object.entries(FIELD_REGISTRY)) {
    if (!isTierAtLeast(tier, meta.tier)) continue;
    if (hiddenByModel.has(field as TrainingFieldName)) continue;
    if (meta.capability && !hasCapability(provider, meta.capability)) continue;
    visible.add(field as TrainingFieldName);
  }
  return visible;
}
