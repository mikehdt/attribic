/**
 * Model definitions and default hyperparameters for training.
 * This is the single source of truth for what models are available
 * and what their sensible defaults are.
 */

import type { TrainingProvider } from './types';

export type ModelArchitecture =
  'flux' | 'sdxl' | 'zimage' | 'anima' | 'wan' | 'ltx';

export type ModelComponentType =
  'checkpoint' | 'vae' | 't5' | 'clip_l' | 'ae' | 'qwen';

export type ModelComponent = {
  type: ModelComponentType;
  label: string;
  required: boolean;
  hint?: string;
  /** ID of the downloadable model in the model manager registry */
  downloadId?: string;
};

export type ModelDefinition = {
  id: string;
  name: string;
  architecture: ModelArchitecture;
  description: string;
  /**
   * Supported training backends, ordered by preference. The first entry is
   * the default selected in the form. `'mock'` is always appended by
   * {@link MODEL_DEFINITIONS} so every model has a fake option for testing.
   */
  providers: TrainingProvider[];
  defaults: TrainingDefaults;
  /** Model components that need local file paths (checkpoint, VAE, text encoders, etc.) */
  components: ModelComponent[];
  /** Optional training tips displayed below the model description */
  tips?: string[];
  /** Resolution steps the user can toggle on/off for this model */
  availableResolutions: number[];
  /** Fields that are irrelevant for this model (auto-set, not configurable) */
  hiddenFields?: (keyof TrainingDefaults)[];
  /**
   * Marks a model as experimental/untested — shows a warning badge in the
   * model select UI. Used for video models that currently only train on
   * still images, and require manually-supplied weights.
   */
  experimental?: boolean;
};

export type TrainingDefaults = {
  steps: number;
  epochs: number;
  learningRate: number;
  optimizer: string;
  scheduler: string;
  warmupSteps: number;
  batchSize: number;
  networkDim: number;
  networkAlpha: number;
  resolution: number[];
  mixedPrecision: 'bf16' | 'fp16';
  /** Transformer weight quantization for VRAM savings. 'none' keeps full precision. */
  transformerQuantization: 'none' | 'float8';
  /** Text encoder weight quantization. */
  textEncoderQuantization: 'none' | 'float8';
  /** Pre-compute text encoder embeddings once and reuse (saves VRAM + time). */
  cacheTextEmbeddings: boolean;
  /** Drop the text encoder from VRAM after caching embeddings. */
  unloadTextEncoder: boolean;
  gradientAccumulationSteps: number;
  gradientCheckpointing: boolean;
  cacheLatents: boolean;
  numRestarts: number;
  weightDecay: number;
  maxGradNorm: number;
  networkDropout: number;
  keepTokens: number;
  captionDropoutRate: number;
  captionShuffling: boolean;
  flipAugment: boolean;
  flipVAugment: boolean;
  loraWeight: number;
  isRegularization: boolean;
  seed: number;
  saveFormat: 'fp16' | 'bf16' | 'fp32';
  saveEvery: number;
  /** How many recent checkpoints to retain. 0 = keep all. */
  maxSavesToKeep: number;
  trainTextEncoder: boolean;
  backboneLR: number;
  textEncoderLR: number;
  /** Use exponential moving average weights during training. */
  ema: boolean;
  /** Loss function for diffusion training. */
  lossType: 'mse' | 'huber' | 'smooth_l1';
  /** Timestep sampling schedule for flow-matching models (sigmoid/linear/shift). */
  timestepType: string;
  /** Bias the timestep distribution towards earlier/later/balanced training. */
  timestepBias: 'balanced' | 'earlier' | 'later';
  sampleEvery: number;
  guidanceScale: number;
  sampleSteps: number;
  sampleSampler: string;
};

/**
 * Shared baseline hyperparameters. Every model derives its `defaults` by
 * spreading this and overriding only the fields that genuinely differ, so
 * there is one source of truth for the common values instead of ~45 fields
 * copied per model.
 */
const BASE_DEFAULTS: TrainingDefaults = {
  steps: 2000,
  epochs: 20,
  learningRate: 1e-4,
  optimizer: 'adamw8bit',
  scheduler: 'constant',
  warmupSteps: 0,
  batchSize: 1,
  networkDim: 16,
  networkAlpha: 16,
  resolution: [512, 768, 1024],
  mixedPrecision: 'bf16',
  transformerQuantization: 'float8',
  textEncoderQuantization: 'float8',
  cacheTextEmbeddings: false,
  unloadTextEncoder: false,
  gradientAccumulationSteps: 1,
  gradientCheckpointing: true,
  cacheLatents: true,
  numRestarts: 3,
  weightDecay: 0,
  maxGradNorm: 1,
  networkDropout: 0,
  keepTokens: 0,
  captionDropoutRate: 0,
  captionShuffling: false,
  flipAugment: false,
  flipVAugment: false,
  loraWeight: 1,
  isRegularization: false,
  seed: -1,
  saveFormat: 'fp16',
  saveEvery: 1,
  maxSavesToKeep: 4,
  trainTextEncoder: false,
  backboneLR: 0,
  textEncoderLR: 0,
  ema: false,
  lossType: 'mse',
  timestepType: 'sigmoid',
  timestepBias: 'balanced',
  sampleEvery: 500,
  guidanceScale: 4,
  sampleSteps: 20,
  sampleSampler: 'euler_a',
};

export const MODEL_DEFINITIONS: ModelDefinition[] = [
  {
    id: 'flux2',
    name: 'Flux.2 Klein 9B',
    architecture: 'flux',
    description: 'Latest generation, practical for home GPUs (~18 GB fp16)',
    providers: ['ai-toolkit', 'mock'],
    components: [
      {
        type: 'checkpoint',
        label: 'Model File',
        required: true,
        downloadId: 'dl-flux2-klein-9b',
      },
      {
        type: 'qwen',
        label: 'Qwen3 8B Text Encoder',
        required: true,
        downloadId: 'shared-qwen3-8b',
      },
      {
        type: 'ae',
        label: 'VAE / Autoencoder',
        required: true,
        hint: 'Note: Flux.2 uses a different AE from Flux.1',
        downloadId: 'shared-flux2-vae',
      },
    ],
    tips: [
      'Constant scheduler with 1e-4 LR works well for most LoRAs',
      'Multi-resolution training (512/768/1024) improves flexibility',
      'Uses Qwen3 text encoder instead of T5-XXL + CLIP-L',
    ],
    availableResolutions: [256, 512, 768, 1024, 1536, 2048],
    defaults: {
      ...BASE_DEFAULTS,
      sampleEvery: 250,
    },
  },
  {
    id: 'flux-dev',
    name: 'Flux.1 Dev',
    architecture: 'flux',
    description: 'Best for photorealistic styles and characters',
    providers: ['ai-toolkit', 'mock'],
    components: [
      {
        type: 'checkpoint',
        label: 'Model File',
        required: true,
        downloadId: 'dl-flux-dev',
      },
      {
        type: 't5',
        label: 'T5-XXL Text Encoder',
        required: true,
        downloadId: 'shared-t5-xxl',
      },
      {
        type: 'clip_l',
        label: 'CLIP-L Text Encoder',
        required: true,
        downloadId: 'shared-clip-l',
      },
      {
        type: 'ae',
        label: 'Autoencoder (AE)',
        required: true,
        downloadId: 'shared-flux-ae',
      },
    ],
    tips: [
      'Constant scheduler with 1e-4 LR is reliable for most use cases',
      'Rank 16 is a good starting point; increase for complex subjects',
    ],
    availableResolutions: [256, 512, 768, 1024, 1536, 2048],
    defaults: {
      ...BASE_DEFAULTS,
      sampleEvery: 250,
    },
  },
  {
    id: 'flux-schnell',
    name: 'Flux.1 Schnell',
    architecture: 'flux',
    description: 'Fast generation, fewer steps needed',
    providers: ['ai-toolkit', 'mock'],
    components: [
      {
        type: 'checkpoint',
        label: 'Model File',
        required: true,
        downloadId: 'dl-flux-schnell',
      },
      {
        type: 't5',
        label: 'T5-XXL Text Encoder',
        required: true,
        downloadId: 'shared-t5-xxl',
      },
      {
        type: 'clip_l',
        label: 'CLIP-L Text Encoder',
        required: true,
        downloadId: 'shared-clip-l',
      },
      {
        type: 'ae',
        label: 'Autoencoder (AE)',
        required: true,
        downloadId: 'shared-flux-ae',
      },
    ],
    tips: [
      'Needs fewer training steps than Flux.1 Dev',
      'Uses unconditioned generation (guidance scale 1.0)',
    ],
    availableResolutions: [256, 512, 768, 1024, 1536, 2048],
    defaults: {
      ...BASE_DEFAULTS,
      steps: 1500,
      epochs: 15,
      sampleEvery: 250,
      guidanceScale: 1,
      sampleSteps: 4,
    },
  },
  {
    id: 'sdxl',
    name: 'Stable Diffusion XL',
    architecture: 'sdxl',
    description: 'Mature ecosystem, wide compatibility',
    providers: ['kohya', 'ai-toolkit', 'mock'],
    components: [
      {
        type: 'checkpoint',
        label: 'Model File',
        required: true,
        downloadId: 'dl-sdxl-base',
      },
      {
        type: 'vae',
        label: 'VAE',
        required: false,
        hint: 'Only needed if the checkpoint doesn\u2019t include one',
        downloadId: 'shared-sdxl-vae',
      },
    ],
    tips: [
      'Cosine scheduler recommended for fine-tuning',
      'Lower alpha (8) helps prevent overfitting',
    ],
    availableResolutions: [768, 1024, 1280, 1536, 1920],
    // Kept hidden on both provider paths (shared by all three SDXL models):
    // - transformer/textEncoder quantization: ai-toolkit has no SDXL quanto
    //   path (the sdxl load branch ignores `quantize`), and Kohya doesn't fp8
    //   SDXL either — pointless here, and SDXL fits comfortably at bf16.
    // - timestepType/timestepBias: flow-matching timestep controls, meaningless
    //   for SDXL's DDPM schedule (Kohya emits neither; ai-toolkit's values only
    //   bite for flow-matching archs).
    hiddenFields: [
      'transformerQuantization',
      'textEncoderQuantization',
      'timestepType',
      'timestepBias',
    ],
    defaults: {
      ...BASE_DEFAULTS,
      steps: 3000,
      scheduler: 'cosine',
      networkAlpha: 8,
      resolution: [1024],
      transformerQuantization: 'none',
      textEncoderQuantization: 'none',
      trainTextEncoder: true,
      guidanceScale: 7,
      sampleSteps: 25,
    },
  },
  {
    id: 'illustrious-xl',
    name: 'Illustrious XL v2.0',
    architecture: 'sdxl',
    description: 'Illustration-focused SDXL base model',
    providers: ['kohya', 'ai-toolkit', 'mock'],
    components: [
      {
        type: 'checkpoint',
        label: 'Model File',
        required: true,
        downloadId: 'dl-illustrious-xl',
      },
      {
        type: 'vae',
        label: 'VAE',
        required: false,
        hint: 'Only needed if the checkpoint doesn\u2019t include one',
        downloadId: 'shared-sdxl-vae',
      },
    ],
    tips: [
      'Cosine scheduler recommended for fine-tuning',
      'Lower alpha (8) helps prevent overfitting',
      'Strong at anime and illustrative styles',
    ],
    availableResolutions: [768, 1024, 1280, 1536, 1920],
    hiddenFields: [
      'transformerQuantization',
      'textEncoderQuantization',
      'timestepType',
      'timestepBias',
    ],
    defaults: {
      ...BASE_DEFAULTS,
      steps: 3000,
      scheduler: 'cosine',
      networkAlpha: 8,
      resolution: [1024],
      trainTextEncoder: true,
      transformerQuantization: 'none',
      textEncoderQuantization: 'none',
      guidanceScale: 7,
      sampleSteps: 25,
    },
  },
  {
    id: 'noob-ai-xl',
    name: 'NoobAI XL 1.1',
    architecture: 'sdxl',
    description: 'Anime/illustration SDXL, non-vpred variant',
    providers: ['kohya', 'ai-toolkit', 'mock'],
    components: [
      {
        type: 'checkpoint',
        label: 'Model File',
        required: true,
        downloadId: 'dl-noob-xl',
      },
      {
        type: 'vae',
        label: 'VAE',
        required: false,
        hint: 'Only needed if the checkpoint doesn\u2019t include one',
        downloadId: 'shared-sdxl-vae',
      },
    ],
    tips: [
      'Cosine scheduler recommended for fine-tuning',
      'Lower alpha (8) helps prevent overfitting',
      'Good for anime and character training',
    ],
    availableResolutions: [768, 1024, 1280, 1536, 1920],
    hiddenFields: [
      'transformerQuantization',
      'textEncoderQuantization',
      'timestepType',
      'timestepBias',
    ],
    defaults: {
      ...BASE_DEFAULTS,
      steps: 3000,
      scheduler: 'cosine',
      networkAlpha: 8,
      resolution: [1024],
      trainTextEncoder: true,
      transformerQuantization: 'none',
      textEncoderQuantization: 'none',
      guidanceScale: 7,
      sampleSteps: 25,
    },
  },
  {
    id: 'zimage-turbo',
    name: 'Z-Image Turbo',
    architecture: 'zimage',
    description: 'Fast, high-quality image generation',
    providers: ['ai-toolkit', 'mock'],
    components: [
      {
        type: 'checkpoint',
        label: 'Model File',
        required: true,
        downloadId: 'dl-zimage-turbo',
        hint: 'Diffusers pipeline directory — everything bundled in one download',
      },
    ],
    tips: [
      'Fewer sample steps needed (8) due to turbo architecture',
      'Uses Qwen3-4B as the text encoder — no separate T5/CLIP needed',
    ],
    availableResolutions: [256, 512, 768, 1024, 1536, 2048],
    defaults: {
      ...BASE_DEFAULTS,
      sampleEvery: 250,
      sampleSteps: 8,
    },
  },
  {
    id: 'anima',
    name: 'Anima',
    architecture: 'anima',
    description:
      'Compact anime-focused DiT (~2B). Light on VRAM, trains fast on consumer GPUs',
    providers: ['kohya', 'mock'],
    components: [
      {
        type: 'checkpoint',
        label: 'Anima DiT Model',
        required: true,
        downloadId: 'dl-anima-dit',
      },
      {
        type: 'qwen',
        label: 'Qwen3 0.6B Text Encoder',
        required: true,
        downloadId: 'shared-anima-qwen3',
      },
      {
        type: 'vae',
        label: 'Qwen-Image VAE',
        required: true,
        downloadId: 'shared-anima-vae',
      },
    ],
    tips: [
      'Rank 32 is the community standard for Anima — unlike SDXL, dim 16 tends to underfit',
      'Lower epochs are generally better; too many and it starts over-fitting the style',
      'Batch 2+ trains more reliably than batch 1 (bump the LR if you raise it to 4)',
      'The Qwen3 text encoder (LLM adapter) stays frozen; leave text-encoder training off',
      'fp8 quantisation is not supported for Anima and is disabled',
    ],
    availableResolutions: [512, 768, 1024, 1536],
    hiddenFields: [
      'timestepBias',
      'transformerQuantization',
      'textEncoderQuantization',
    ],
    defaults: {
      ...BASE_DEFAULTS,
      steps: 1600,
      epochs: 16,
      learningRate: 5e-5,
      scheduler: 'cosine',
      warmupSteps: 100,
      batchSize: 2,
      networkDim: 32,
      networkAlpha: 32,
      resolution: [768, 1024],
      transformerQuantization: 'none',
      textEncoderQuantization: 'none',
      sampleEvery: 250,
    },
  },
  {
    id: 'wan22-14b',
    name: 'Wan 2.2 14B',
    architecture: 'wan',
    description: 'Video/image generation, last open-weights release',
    providers: ['ai-toolkit', 'mock'],
    components: [{ type: 'checkpoint', label: 'Model File', required: true }],
    tips: [
      'Higher rank (32) and learning rate (2e-4) suit this larger model',
      'Supports image-only training via single-frame clips',
    ],
    availableResolutions: [256, 512, 768, 1024],
    hiddenFields: ['trainTextEncoder'],
    experimental: true,
    defaults: {
      ...BASE_DEFAULTS,
      learningRate: 2e-4,
      networkDim: 32,
      resolution: [512, 768],
    },
  },
  {
    id: 'ltx2',
    name: 'LTX-Video 2',
    architecture: 'ltx',
    description: 'Actively evolving open video model',
    providers: ['ai-toolkit', 'mock'],
    components: [{ type: 'checkpoint', label: 'Model File', required: true }],
    tips: [
      'Higher rank (32) recommended for video model capacity',
      'Supports image-only training via single-frame clips',
    ],
    availableResolutions: [256, 512, 768, 1024],
    hiddenFields: ['trainTextEncoder'],
    experimental: true,
    defaults: {
      ...BASE_DEFAULTS,
      networkDim: 32,
      resolution: [512, 768],
    },
  },
  {
    id: 'ltx23',
    name: 'LTX-Video 2.3',
    architecture: 'ltx',
    description: 'Latest LTX with improved motion and quality',
    providers: ['ai-toolkit', 'mock'],
    components: [{ type: 'checkpoint', label: 'Model File', required: true }],
    tips: [
      'Higher rank (32) recommended for video model capacity',
      'Supports image-only training via single-frame clips',
    ],
    availableResolutions: [256, 512, 768, 1024],
    hiddenFields: ['trainTextEncoder'],
    experimental: true,
    defaults: {
      ...BASE_DEFAULTS,
      networkDim: 32,
      resolution: [512, 768],
    },
  },
];

export const ARCHITECTURE_LABELS: Record<ModelArchitecture, string> = {
  flux: 'Flux',
  sdxl: 'Stable Diffusion',
  zimage: 'Z-Image',
  anima: 'Anima',
  wan: 'Wan',
  ltx: 'LTX-Video',
};

export const OPTIMIZER_OPTIONS = [
  {
    group: 'Recommended',
    items: [
      {
        value: 'adamw8bit',
        label: 'AdamW 8-bit',
        hint: 'Good balance of speed and VRAM',
      },
    ],
  },
  {
    group: 'Memory-efficient',
    items: [
      { value: 'adafactor', label: 'Adafactor', hint: 'Lower VRAM usage' },
      {
        value: 'prodigy',
        label: 'Prodigy',
        hint: 'Auto-adjusts learning rate',
      },
    ],
  },
  {
    group: 'Advanced',
    items: [
      { value: 'adamw', label: 'AdamW', hint: 'Standard, more VRAM' },
      { value: 'lion', label: 'Lion', hint: 'Fast convergence' },
      {
        value: 'dadaptation',
        label: 'DAdaptation',
        hint: 'Auto-adjusts learning rate',
      },
    ],
  },
];

type SchedulerOption = {
  value: string;
  label: string;
  hint: string;
  /** Normalised values 0-1 for the sparkline, 16 points */
  curve: number[];
};

export const SCHEDULER_OPTIONS: SchedulerOption[] = [
  {
    value: 'constant',
    label: 'Constant',
    hint: 'Flat — simple and predictable',
    curve: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  },
  {
    value: 'constant_with_warmup',
    label: 'Constant + Warmup',
    hint: 'Ramp up then flat — good with Prodigy',
    curve: [0.05, 0.15, 0.35, 0.6, 0.85, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  },
  {
    value: 'cosine',
    label: 'Cosine (no restarts)',
    hint: 'Gentle decay — most popular for fine-tuning',
    curve: [
      1, 0.98, 0.93, 0.85, 0.75, 0.63, 0.5, 0.37, 0.25, 0.17, 0.1, 0.06, 0.03,
      0.01, 0.005, 0.002,
    ],
  },
  {
    value: 'cosine_with_restarts',
    label: 'Cosine + Restarts',
    hint: 'Waves — good for longer training',
    curve: [
      1, 0.75, 0.35, 0.05, 0.35, 0.75, 1, 0.75, 0.35, 0.05, 0.35, 0.75, 1, 0.75,
      0.35, 0.05,
    ],
  },
  {
    value: 'linear',
    label: 'Linear',
    hint: 'Steady decrease',
    curve: [
      1, 0.93, 0.87, 0.8, 0.73, 0.67, 0.6, 0.53, 0.47, 0.4, 0.33, 0.27, 0.2,
      0.13, 0.07, 0.01,
    ],
  },
];

export function getModelById(id: string): ModelDefinition | undefined {
  return MODEL_DEFINITIONS.find((m) => m.id === id);
}

export function getModelsByArchitecture(): {
  architecture: ModelArchitecture;
  label: string;
  models: ModelDefinition[];
}[] {
  const groups = new Map<ModelArchitecture, ModelDefinition[]>();
  for (const model of MODEL_DEFINITIONS) {
    const existing = groups.get(model.architecture) ?? [];
    existing.push(model);
    groups.set(model.architecture, existing);
  }
  return Array.from(groups.entries()).map(([arch, models]) => ({
    architecture: arch,
    label: ARCHITECTURE_LABELS[arch],
    models,
  }));
}
