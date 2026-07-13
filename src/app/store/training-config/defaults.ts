import {
  getModelById,
  MODEL_DEFINITIONS,
  type TrainingDefaults,
} from '@/app/services/training/models';

import type { FolderAugmentation, FormState } from './types';

export function defaultFolderAugmentation(
  defaults: TrainingDefaults,
): FolderAugmentation {
  return {
    captionShuffling: defaults.captionShuffling,
    captionDropoutRate: defaults.captionDropoutRate,
    keepTokens: defaults.keepTokens,
    flipAugment: defaults.flipAugment,
    flipVAugment: defaults.flipVAugment,
    loraWeight: defaults.loraWeight,
    isRegularization: defaults.isRegularization,
  };
}

export function defaultsToFormState(
  defaults: TrainingDefaults,
  modelId: string,
): FormState {
  const model = getModelById(modelId);
  return {
    modelId,
    selectedProvider: model?.providers[0] ?? 'ai-toolkit',
    modelPaths: {},
    outputName: '',
    datasets: [],
    extraFolders: [],
    durationMode: 'epochs',
    epochs: defaults.epochs,
    steps: defaults.steps,
    learningRate: defaults.learningRate,
    optimizer: defaults.optimizer,
    scheduler: defaults.scheduler,
    warmupSteps: defaults.warmupSteps,
    numRestarts: defaults.numRestarts,
    weightDecay: defaults.weightDecay,
    maxGradNorm: defaults.maxGradNorm,
    trainTextEncoder: defaults.trainTextEncoder,
    backboneLR: defaults.backboneLR,
    textEncoderLR: defaults.textEncoderLR,
    ema: defaults.ema,
    lossType: defaults.lossType,
    timestepType: defaults.timestepType,
    timestepBias: defaults.timestepBias,
    discreteFlowShift: defaults.discreteFlowShift,
    minSnrGamma: defaults.minSnrGamma,
    noiseOffset: defaults.noiseOffset,
    emaDecay: defaults.emaDecay,
    networkType: 'lora',
    networkDim: defaults.networkDim,
    networkAlpha: defaults.networkAlpha,
    networkDimAlphaLinked: defaults.networkDim === defaults.networkAlpha,
    networkDropout: defaults.networkDropout,
    scaleWeightNorms: defaults.scaleWeightNorms,
    batchSize: defaults.batchSize,
    resolution: defaults.resolution,
    mixedPrecision: defaults.mixedPrecision,
    transformerQuantization: defaults.transformerQuantization,
    textEncoderQuantization: defaults.textEncoderQuantization,
    cacheTextEmbeddings: defaults.cacheTextEmbeddings,
    unloadTextEncoder: defaults.unloadTextEncoder,
    gradientAccumulationSteps: defaults.gradientAccumulationSteps,
    gradientCheckpointing: defaults.gradientCheckpointing,
    cacheLatents: defaults.cacheLatents,
    bucketResoSteps: defaults.bucketResoSteps,
    bucketNoUpscale: defaults.bucketNoUpscale,
    nativeResolution: defaults.nativeResolution,
    samplingEnabled: false,
    samplePrompts: [''],
    sampleMode: 'steps',
    sampleEveryEpochs: 1,
    sampleEverySteps: defaults.sampleEvery,
    sampleSteps: defaults.sampleSteps,
    seed: defaults.seed,
    guidanceScale: defaults.guidanceScale,
    sampleSampler: defaults.sampleSampler,
    saveEnabled: false,
    saveMode: 'epochs',
    saveEveryEpochs: defaults.saveEvery,
    saveEverySteps: 250,
    saveFormat: defaults.saveFormat,
    maxSavesToKeep: defaults.maxSavesToKeep,
    saveState: false,
    resumeState: '',
    networkArgs: defaults.networkArgs,
    optimizerArgs: defaults.optimizerArgs,
    blocksToSwap: defaults.blocksToSwap,
    lokrFactor: defaults.lokrFactor,
    contentOrStyle: defaults.contentOrStyle,
    diffOutputPreservation: defaults.diffOutputPreservation,
    diffOutputPreservationMultiplier: defaults.diffOutputPreservationMultiplier,
    diffOutputPreservationClass: defaults.diffOutputPreservationClass,
    layerTargeting: defaults.layerTargeting,
    lowVram: defaults.lowVram,
  };
}

export function getDefaults(modelId: string): TrainingDefaults {
  const model = getModelById(modelId);
  return model?.defaults ?? MODEL_DEFINITIONS[0].defaults;
}

export function initialFormState(): FormState {
  const initialModel = MODEL_DEFINITIONS[0];
  return defaultsToFormState(initialModel.defaults, initialModel.id);
}
