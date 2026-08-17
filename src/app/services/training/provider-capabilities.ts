/**
 * Provider-capability model for the training form. Replaces per-field
 * `providers: [...]` allowlists (and scattered `provider === 'kohya'`
 * branches) with named capabilities, so a third sd-scripts-lineage backend
 * (e.g. musubi-tuner) only needs to be added to {@link PROVIDER_CAPABILITIES}
 * rather than touched in ~25 places.
 */

import type { TrainingProvider } from './types';

/**
 * One member per distinct thing the UI gates on — a field, a group of fields
 * that always show/hide together, or a literal branch elsewhere in the form
 * (vertical-flip augmentation, the final-save exemption in checkpoint
 * pruning, the bucket/native-resolution dataset-shape preview).
 */
export type ProviderCapability =
  | 'lrSchedulerControls' // scheduler, warmupSteps, numRestarts
  | 'optimizerExtraArgs' // weightDecay, optimizerArgs
  | 'networkExtraArgs' // networkArgs
  | 'scaleWeightNorms'
  | 'ddpmNoiseControls' // minSnrGamma, noiseOffset
  | 'discreteFlowShift'
  | 'latentCacheToggle' // cacheLatents
  | 'bucketControls' // bucketResoSteps, bucketNoUpscale
  | 'nativeResolution'
  | 'gradientCheckpointingToggle'
  | 'blockSwap' // blocksToSwap
  | 'saveFormat'
  | 'verticalFlip'
  | 'finalSaveExempt'
  | 'datasetShapePreview'
  | 'ema' // ema, emaDecay
  | 'lossType'
  | 'timestepBias'
  | 'backboneLr'
  | 'quantization' // transformerQuantization, textEncoderQuantization
  | 'teCacheToggle' // cacheTextEmbeddings
  | 'unloadTextEncoder'
  | 'networkTypeSelect' // networkType
  | 'lokr' // lokrFactor
  | 'layerTargeting'
  | 'dop' // diffOutputPreservation, ...Multiplier, ...Class
  | 'contentOrStyle'
  | 'lowVram';

/**
 * Capabilities shared by every sd-scripts-lineage backend (kohya today,
 * musubi-tuner or similar later). A new backend in this family starts from
 * this set plus whichever of its own extras it actually has.
 */
const SD_SCRIPTS_FAMILY: readonly ProviderCapability[] = [
  'lrSchedulerControls',
  'optimizerExtraArgs',
  'networkExtraArgs',
  'scaleWeightNorms',
  'discreteFlowShift',
  'bucketControls',
  'nativeResolution',
  'gradientCheckpointingToggle',
  'saveFormat',
  'finalSaveExempt',
  'datasetShapePreview',
];

/**
 * Every capability that exists — used to give `mock` the full set. Written as
 * a Record so the compiler rejects a union member missing from this list.
 */
const CAPABILITY_SET: Record<ProviderCapability, true> = {
  lrSchedulerControls: true,
  optimizerExtraArgs: true,
  networkExtraArgs: true,
  scaleWeightNorms: true,
  ddpmNoiseControls: true,
  discreteFlowShift: true,
  latentCacheToggle: true,
  bucketControls: true,
  nativeResolution: true,
  gradientCheckpointingToggle: true,
  blockSwap: true,
  saveFormat: true,
  verticalFlip: true,
  finalSaveExempt: true,
  datasetShapePreview: true,
  ema: true,
  lossType: true,
  timestepBias: true,
  backboneLr: true,
  quantization: true,
  teCacheToggle: true,
  unloadTextEncoder: true,
  networkTypeSelect: true,
  lokr: true,
  layerTargeting: true,
  dop: true,
  contentOrStyle: true,
  lowVram: true,
};

const ALL_CAPABILITIES = Object.keys(CAPABILITY_SET) as ProviderCapability[];

const PROVIDER_CAPABILITIES: Record<
  TrainingProvider,
  ReadonlySet<ProviderCapability>
> = {
  // `quantization` arrived with the Flux.1 models (--fp8_base/--fp8_base_unet)
  // — the older kohya models (SDXL family, Anima) hide those fields per-model,
  // so they see no change.
  kohya: new Set([
    ...SD_SCRIPTS_FAMILY,
    'ddpmNoiseControls',
    'latentCacheToggle',
    'blockSwap',
    'quantization',
  ]),
  // Musubi shares the sd-scripts family set, plus block swap and runtime fp8
  // quantisation. Deliberately absent: ddpmNoiseControls (every musubi arch is
  // flow-matching), latentCacheToggle (caching is mandatory and external),
  // verticalFlip (no such augmentation).
  musubi: new Set([...SD_SCRIPTS_FAMILY, 'blockSwap', 'quantization']),
  'ai-toolkit': new Set([
    // SaveConfig.dtype takes the same fp16/bf16/fp32 spellings the form
    // sends; the provider passed a hardcoded float16 until 2026-08-17.
    'saveFormat',
    'ema',
    'lossType',
    'timestepBias',
    'backboneLr',
    'quantization',
    'teCacheToggle',
    'unloadTextEncoder',
    'networkTypeSelect',
    'lokr',
    'layerTargeting',
    'dop',
    'contentOrStyle',
    'lowVram',
    'verticalFlip',
  ]),
  // Mock is a fake backend for UI testing, so it shows every field/branch
  // regardless of which real provider(s) support it. Derived from the full
  // list so a newly added capability can't be forgotten here.
  mock: new Set(ALL_CAPABILITIES),
};

export function hasCapability(
  provider: TrainingProvider,
  capability: ProviderCapability,
): boolean {
  return PROVIDER_CAPABILITIES[provider].has(capability);
}
