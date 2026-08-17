/**
 * Model definitions and default hyperparameters for training.
 * This is the single source of truth for what models are available
 * and what their sensible defaults are.
 */

import type { TrainingFieldName } from './field-registry';
import { TRAINING_PROVIDER_SHORT_LABELS, type TrainingProvider } from './types';

export type ModelArchitecture =
  'flux' | 'sdxl' | 'zimage' | 'krea2' | 'qwenimage' | 'anima' | 'wan' | 'ltx';

export type ModelComponentType =
  | 'checkpoint'
  | 'vae'
  | 't5'
  | 'clip_l'
  | 'ae'
  | 'qwen'
  | 'training_adapter'
  /**
   * A whole diffusers pipeline directory rather than a weights file. Distinct
   * from `checkpoint` because a model can need *both* shapes depending on the
   * backend — Anima is single-file DiT + TE + VAE under kohya, but a pipeline
   * directory under ai-toolkit — and the two must not overwrite each other's
   * path when the backend is switched. (Z-Image predates this and carries its
   * pipeline directory under `checkpoint`; it has only ever had one backend.)
   */
  | 'diffusers';

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
  /**
   * Per-backend overrides of {@link components}, for models the two trainers
   * load differently. Only set where the weights genuinely differ in shape —
   * a backend with no entry uses `components`.
   */
  providerComponents?: Partial<Record<TrainingProvider, ModelComponent[]>>;
  /** Optional training tips displayed below the model description */
  tips?: string[];
  /** Resolution steps the user can toggle on/off for this model */
  availableResolutions: number[];
  /**
   * Fields that are irrelevant for this model (auto-set, not configurable).
   * Matched against {@link TrainingFieldName} directly — not the
   * `TrainingDefaults` key — so fields with `defaultKey: null` (no model
   * default to compare against) can still be hidden per-model.
   */
  hiddenFields?: TrainingFieldName[];
  /**
   * Marks a model as experimental/untested — shows a warning badge in the
   * model select UI. Used for video models that currently only train on
   * still images, and require manually-supplied weights.
   */
  experimental?: boolean;
  /**
   * Kept out of the model pickers (training form and Model Manager) without
   * being deleted: a saved config that names a hidden model still resolves
   * via {@link getModelById} and renders its own selection. Used for the
   * video models (Wan, LTX) until their UI/UX is actually built out.
   */
  hidden?: boolean;
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
  /** Kohya-only: rectified-flow timestep shift (flow-matching models only). */
  discreteFlowShift: number;
  /** Kohya-only: caps LoRA weight norms. 0 = disabled. */
  scaleWeightNorms: number;
  /** Kohya-only, DDPM models only: min-SNR loss weighting gamma. 0 = disabled. */
  minSnrGamma: number;
  /** Kohya-only, DDPM models only: noise offset. 0 = disabled. */
  noiseOffset: number;
  /** Kohya-only: bucket resolution step size when multi-resolution bucketing is on. */
  bucketResoSteps: number;
  /** Kohya-only: disallow upscaling small images to fit a bucket. */
  bucketNoUpscale: boolean;
  /**
   * Kohya-only: exact `WxH` training size, e.g. `'1280x768'`. Empty = off.
   *
   * When set it overrides `resolution` entirely: the dataset TOML gets
   * `resolution = [W, H]` with bucketing disabled, so images sized exactly WxH
   * reach the VAE untouched. Without it a single `resolution` entry means a
   * *square* WxW (sd-scripts resizes to fit and centre-crops), and multiple
   * entries bucket — both of which resample. That resampling is fatal for
   * pixel art, where a non-integer rescale destroys the pixel grid.
   */
  nativeResolution: string;
  /** ai-toolkit-only: EMA decay rate, only used when `ema` is enabled. */
  emaDecay: number;
  // --- Expert tier ---
  /** Kohya-only: raw --network_args key=value pairs, space-separated. */
  networkArgs: string;
  /** Kohya-only: raw --optimizer_args key=value pairs, space-separated. */
  optimizerArgs: string;
  /** Kohya-only (anima): transformer blocks to offload to CPU. 0 = disabled. */
  blocksToSwap: number;
  /** ai-toolkit-only: LoKr decomposition factor. -1 = auto-detect largest. */
  lokrFactor: number;
  /** ai-toolkit-only: bias training toward content vs style. */
  contentOrStyle: 'balanced' | 'content' | 'style';
  /** ai-toolkit-only: differential output preservation (DOP). */
  diffOutputPreservation: boolean;
  /** ai-toolkit-only: DOP loss multiplier, only used when DOP is enabled. */
  diffOutputPreservationMultiplier: number;
  /** ai-toolkit-only: DOP class word, only used when DOP is enabled. */
  diffOutputPreservationClass: string;
  /** ai-toolkit-only: comma-separated layer-name substrings to restrict LoRA to. */
  layerTargeting: string;
  /** ai-toolkit-only: low-VRAM mode (offloads model components). */
  lowVram: boolean;
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
  // VRAM-conservative by default (ai-toolkit only). Keeping the text encoder
  // resident during training tips a large model (e.g. Z-Image) past 16 GB,
  // which silently spills into system RAM and drags each step to minutes.
  // Pre-caching TE embeddings and dropping the encoder from VRAM avoids that;
  // users can turn them off when they have headroom.
  cacheTextEmbeddings: true,
  unloadTextEncoder: true,
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
  discreteFlowShift: 1.0,
  scaleWeightNorms: 0,
  minSnrGamma: 0,
  noiseOffset: 0,
  bucketResoSteps: 64,
  bucketNoUpscale: false,
  nativeResolution: '',
  emaDecay: 0.99,
  networkArgs: '',
  optimizerArgs: '',
  blocksToSwap: 0,
  lokrFactor: -1,
  contentOrStyle: 'balanced',
  diffOutputPreservation: false,
  diffOutputPreservationMultiplier: 1.0,
  diffOutputPreservationClass: '',
  layerTargeting: '',
  // See cacheTextEmbeddings/unloadTextEncoder above — enable ai-toolkit's
  // block-swapping low-VRAM mode by default so 16 GB cards don't spill.
  lowVram: true,
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
    // Both backends load the same four single-file weights, so no
    // providerComponents split is needed (unlike Anima).
    providers: ['ai-toolkit', 'kohya', 'mock'],
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
      'On SD Scripts, Shift timestep sampling (flow shift ~3.16) with fp8 quantisation and block swap is the documented 16 GB recipe',
    ],
    availableResolutions: [256, 512, 768, 1024, 1536, 2048],
    // Flow-matching arch on both backends: the DDPM-only noise controls don't
    // exist here, and neither backend honours a sampler choice (sd-scripts
    // hard-wires flow-matching Euler; ai-toolkit forces `flowmatch` for any
    // flow-matching arch).
    hiddenFields: ['minSnrGamma', 'noiseOffset', 'sampleSampler'],
    defaults: {
      ...BASE_DEFAULTS,
      sampleEvery: 250,
      // sd-scripts' recommended flux recipe pairs Shift sampling with this
      // value; pre-set so switching Timestep Type to Shift lands on it.
      // (ai-toolkit doesn't consult discreteFlowShift.)
      discreteFlowShift: 3.1582,
    },
  },
  {
    id: 'flux-schnell',
    name: 'Flux.1 Schnell',
    architecture: 'flux',
    description: 'Fast generation, fewer steps needed',
    providers: ['ai-toolkit', 'kohya', 'mock'],
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
    hiddenFields: ['minSnrGamma', 'noiseOffset', 'sampleSampler'],
    defaults: {
      ...BASE_DEFAULTS,
      steps: 1500,
      epochs: 15,
      sampleEvery: 250,
      guidanceScale: 1,
      sampleSteps: 4,
      discreteFlowShift: 3.1582,
    },
  },
  // Flux.2 Klein *base* checkpoints — the undistilled variants Musubi trains
  // on. Separate models from `flux2` above: that entry is ai-toolkit's
  // diffusers path around the distilled Klein 9B download, while these take
  // the single-file klein-base DiT plus the shared Qwen3 TE and Flux.2 AE
  // (musubi's loader reads the same Comfy-Org single-file weights Z-Image
  // uses — verified against its `load_qwen3`/`load_ae` strict loaders).
  {
    id: 'flux2-klein-base-4b',
    name: 'Flux.2 Klein Base 4B',
    architecture: 'flux',
    description:
      'Undistilled Klein 4B — light enough to train comfortably on 16 GB',
    providers: ['musubi', 'mock'],
    components: [
      {
        type: 'checkpoint',
        label: 'Klein Base 4B DiT',
        required: true,
        downloadId: 'dl-flux2-klein-base-4b',
      },
      {
        type: 'qwen',
        label: 'Qwen3 4B Text Encoder',
        required: true,
        downloadId: 'shared-zimage-qwen3',
        hint: 'Same Qwen3 4B file Z-Image Base uses',
      },
      {
        type: 'ae',
        label: 'Flux.2 VAE',
        required: true,
        downloadId: 'shared-flux2-vae',
      },
    ],
    tips: [
      'Train on Klein Base — the distilled Klein 4B/9B checkpoints are inference models',
      'A LoRA trained on Base applies to the distilled Klein at inference',
      'Latents and text-encoder outputs are pre-cached before each run; unchanged re-runs skip both in seconds',
    ],
    availableResolutions: [512, 768, 1024, 1536],
    hiddenFields: [
      // Musubi trains the network only — no TE-unfreeze path.
      'trainTextEncoder',
      'textEncoderLR',
      'timestepBias',
      // Flow-matching arch: DDPM-only mechanisms don't exist here.
      'minSnrGamma',
      'noiseOffset',
      // Caching is mandatory and runs as separate pre-phases.
      'cacheLatents',
      'bucketResoSteps',
      // Fixed per-arch sampler.
      'sampleSampler',
      // Flux.2 uses its own resolution-aware `flux2_shift` schedule — the
      // sidecar always passes it, so neither knob applies.
      'timestepType',
      'discreteFlowShift',
    ],
    defaults: {
      ...BASE_DEFAULTS,
      steps: 2500,
      epochs: 25,
      networkDim: 32,
      networkAlpha: 32,
      resolution: [1024],
      saveFormat: 'bf16',
      timestepType: 'flux2_shift',
      sampleEvery: 250,
      sampleSteps: 28,
    },
  },
  {
    id: 'flux2-klein-base-9b',
    name: 'Flux.2 Klein Base 9B',
    architecture: 'flux',
    description:
      'Undistilled Klein 9B — the training base for Flux.2 Klein LoRAs',
    providers: ['musubi', 'mock'],
    components: [
      {
        type: 'checkpoint',
        label: 'Klein Base 9B DiT',
        required: true,
        downloadId: 'dl-flux2-klein-base-9b',
      },
      {
        type: 'qwen',
        label: 'Qwen3 8B Text Encoder',
        required: true,
        downloadId: 'shared-qwen3-8b',
        hint: 'bf16 variant — Musubi rejects pre-quantised fp8 weights',
      },
      {
        type: 'ae',
        label: 'Flux.2 VAE',
        required: true,
        downloadId: 'shared-flux2-vae',
      },
    ],
    tips: [
      'Train on Klein Base — the distilled Klein 4B/9B checkpoints are inference models',
      'A LoRA trained on Base applies to the distilled Klein at inference',
      'fp8 quantisation plus block swap (max 16) is what fits the 9B DiT on 16 GB cards',
    ],
    availableResolutions: [512, 768, 1024, 1536],
    hiddenFields: [
      'trainTextEncoder',
      'textEncoderLR',
      'timestepBias',
      'minSnrGamma',
      'noiseOffset',
      'cacheLatents',
      'bucketResoSteps',
      'sampleSampler',
      'timestepType',
      'discreteFlowShift',
    ],
    defaults: {
      ...BASE_DEFAULTS,
      steps: 2500,
      epochs: 25,
      networkDim: 32,
      networkAlpha: 32,
      resolution: [1024],
      saveFormat: 'bf16',
      timestepType: 'flux2_shift',
      sampleEvery: 250,
      sampleSteps: 28,
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
      // Flow-matching-only timestep shift — SDXL is DDPM, no equivalent flag.
      'discreteFlowShift',
      // Kohya's sdxl_train_network.py doesn't accept --blocks_to_swap (anima
      // only), so hide it on the SDXL-family Kohya path.
      'blocksToSwap',
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
      'discreteFlowShift',
      // sdxl_train_network.py doesn't accept --blocks_to_swap (anima only).
      'blocksToSwap',
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
      'discreteFlowShift',
      // sdxl_train_network.py doesn't accept --blocks_to_swap (anima only).
      'blocksToSwap',
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
      {
        type: 'training_adapter',
        label: 'Training Adapter',
        required: true,
        downloadId: 'dl-zimage-turbo-adapter',
        hint: 'How ai-toolkit de-distils Turbo while training — without it the LoRA comes out inert',
      },
    ],
    tips: [
      'Fewer sample steps needed (8) due to turbo architecture',
      'Uses unconditioned generation (guidance scale 1.0)',
      'Uses Qwen3-4B as the text encoder — no separate T5/CLIP needed',
      'ai-toolkit needs the training adapter to de-distil Turbo while training',
      'Hungry for steps — a small single-subject set needs 2,000+ before the concept shows, and multi-concept sets want well past that',
    ],
    availableResolutions: [256, 512, 768, 1024, 1536, 2048],
    defaults: {
      ...BASE_DEFAULTS,
      // Distilled base, trained through the de-distilling adapter: progress
      // per step is slower than an undistilled model. Even small datasets are
      // only starting to take at ~2,000 steps, so aim well past that.
      steps: 4000,
      epochs: 40,
      sampleEvery: 250,
      guidanceScale: 1,
      sampleSteps: 8,
      // ai-toolkit's own Z-Image presets all use `weighted`; `sigmoid` (our
      // cross-model default) is the value they set for *non*-Z-Image archs.
      timestepType: 'weighted',
    },
  },
  {
    id: 'zimage',
    name: 'Z-Image Base',
    architecture: 'zimage',
    description:
      'Undistilled Z-Image base — the variant meant for LoRA training',
    providers: ['musubi', 'mock'],
    components: [
      {
        type: 'checkpoint',
        label: 'Z-Image DiT (bf16)',
        required: true,
        downloadId: 'dl-zimage-base-dit',
        hint: 'bf16 single-file weights — Musubi rejects pre-quantised fp8 repacks',
      },
      {
        type: 'vae',
        label: 'Z-Image VAE',
        required: true,
        downloadId: 'shared-zimage-vae',
      },
      {
        type: 'qwen',
        label: 'Qwen3 4B Text Encoder',
        required: true,
        downloadId: 'shared-zimage-qwen3',
      },
    ],
    tips: [
      'Musubi recommends training on Base over Turbo — the LoRA still applies to Turbo at inference',
      'Latents and text-encoder outputs are pre-cached before each run; a re-run with unchanged settings skips both in seconds',
      'fp8 quantisation plus block swap keeps the 6B DiT comfortable on 16 GB cards',
    ],
    availableResolutions: [512, 768, 1024, 1536],
    hiddenFields: [
      // Musubi trains the network only — there is no --text_encoder_lr or
      // TE-unfreeze path in its parser.
      'trainTextEncoder',
      'textEncoderLR',
      'timestepBias',
      // Flow-matching arch: the DDPM-only mechanisms don't exist here (also
      // capability-gated off for musubi, but hidden per-model so the mock
      // backend doesn't offer them for this model either).
      'minSnrGamma',
      'noiseOffset',
      // Caching is mandatory and runs as separate pre-phases.
      'cacheLatents',
      // Musubi's dataset config has bucket_no_upscale but no bucket_reso_steps.
      'bucketResoSteps',
      // Each musubi arch uses its own fixed sampler — no --sample_sampler.
      'sampleSampler',
    ],
    defaults: {
      ...BASE_DEFAULTS,
      steps: 2500,
      epochs: 25,
      resolution: [1024],
      // Musubi's own --save_precision default is fp32 — the provider always
      // passes this instead.
      saveFormat: 'bf16',
      // docs/zimage.md's recommended flow-matching baseline.
      timestepType: 'shift',
      discreteFlowShift: 2.0,
      sampleEvery: 250,
    },
  },
  {
    id: 'krea2',
    name: 'Krea 2',
    architecture: 'krea2',
    description:
      'Krea 2 RAW — aesthetic-focused MMDiT with a Qwen3-VL text encoder',
    // Musubi trains the RAW single-file DiT with split VAE/TE weights;
    // ai-toolkit loads the same DiT file and auto-downloads its own copies of
    // the TE (Qwen/Qwen3-VL-4B-Instruct) and VAE (Qwen/Qwen-Image) from HF on
    // first run — hence the checkpoint-only component list on that path.
    providers: ['musubi', 'ai-toolkit', 'mock'],
    components: [
      {
        type: 'checkpoint',
        label: 'Krea 2 RAW DiT',
        required: true,
        downloadId: 'dl-krea2-raw',
        hint: 'Train on RAW — the distilled Turbo checkpoint is for inference',
      },
      {
        type: 'vae',
        label: 'Qwen-Image VAE',
        required: true,
        downloadId: 'shared-qwen-image-vae',
      },
      {
        type: 'qwen',
        label: 'Qwen3-VL 4B Text Encoder',
        required: true,
        downloadId: 'shared-qwen3vl-4b',
      },
    ],
    providerComponents: {
      'ai-toolkit': [
        {
          type: 'checkpoint',
          label: 'Krea 2 RAW DiT',
          required: true,
          downloadId: 'dl-krea2-raw',
          hint: 'ai-toolkit fetches the text encoder and VAE from HuggingFace itself on first run',
        },
      ],
    },
    tips: [
      'Train on RAW; the LoRA applies to Krea 2 Turbo at inference',
      'The ~24 GB bf16 DiT wants fp8 quantisation plus block swap (max 26) on 16 GB cards — expect it to be tight',
      'Sample images run real CFG against a default negative prompt; without CFG, RAW output is blurry by design',
    ],
    availableResolutions: [512, 768, 1024, 1280],
    hiddenFields: [
      // Musubi trains the network only — no TE-unfreeze path.
      'trainTextEncoder',
      'textEncoderLR',
      'timestepBias',
      // Flow-matching arch: DDPM-only mechanisms don't exist here.
      'minSnrGamma',
      'noiseOffset',
      // Caching is mandatory and runs as separate pre-phases (musubi).
      'cacheLatents',
      'bucketResoSteps',
      // Fixed per-arch sampler on both backends.
      'sampleSampler',
      // Musubi's krea2 scripts have no TE fp8 flag (the TE is hardcoded
      // bf16), and ai-toolkit's quantize_te default matches this field's
      // default — hidden so the musubi path can't promise what it can't do.
      'textEncoderQuantization',
    ],
    defaults: {
      ...BASE_DEFAULTS,
      steps: 2500,
      epochs: 25,
      networkDim: 32,
      networkAlpha: 32,
      resolution: [1024],
      saveFormat: 'bf16',
      // docs/krea2.md: shift at 2.5 matches K2 inference at 1024x1024.
      timestepType: 'shift',
      discreteFlowShift: 2.5,
      sampleEvery: 250,
      // Krea's reference guidance is offset by one: official 4.5 == 5.5 here.
      guidanceScale: 5.5,
      sampleSteps: 28,
    },
  },
  {
    id: 'qwen-image',
    name: 'Qwen-Image',
    architecture: 'qwenimage',
    description: '20B MMDiT with strong prompt adherence and text rendering',
    providers: ['musubi', 'mock'],
    components: [
      {
        type: 'checkpoint',
        label: 'Qwen-Image DiT (bf16)',
        required: true,
        downloadId: 'dl-qwen-image-dit',
        hint: 'bf16 single-file weights — Musubi rejects pre-quantised fp8 repacks',
      },
      {
        type: 'qwen',
        label: 'Qwen2.5-VL 7B Text Encoder',
        required: true,
        downloadId: 'shared-qwen25vl-7b',
      },
      {
        type: 'vae',
        label: 'Qwen-Image VAE',
        required: true,
        downloadId: 'shared-qwen-image-vae',
      },
    ],
    tips: [
      'The biggest model here (~38 GB download); fp8 plus a 45-block swap brings training under 16 GB, at a real speed cost',
      '64 GB system RAM is the documented floor for heavy block swapping',
      'Latents and text-encoder outputs are pre-cached before each run; unchanged re-runs skip both in seconds',
      'Uses an unusually low flow shift (2.2) compared to other flow-matching models',
    ],
    availableResolutions: [512, 768, 1024, 1328],
    hiddenFields: [
      'trainTextEncoder',
      'textEncoderLR',
      'timestepBias',
      'minSnrGamma',
      'noiseOffset',
      'cacheLatents',
      'bucketResoSteps',
      'sampleSampler',
    ],
    defaults: {
      ...BASE_DEFAULTS,
      steps: 2500,
      epochs: 25,
      // docs/qwen_image.md's LoRA example trains at 5e-5, not the usual 1e-4.
      learningRate: 5e-5,
      resolution: [1024],
      saveFormat: 'bf16',
      timestepType: 'shift',
      discreteFlowShift: 2.2,
      sampleEvery: 250,
      sampleSteps: 25,
      // fp8 + 45 swapped blocks is the doc's 12 GB configuration — the
      // default here so a first run on a 16 GB card doesn't OOM or spill.
      blocksToSwap: 45,
    },
  },
  {
    id: 'anima',
    name: 'Anima',
    architecture: 'anima',
    description:
      'Compact anime-focused DiT (~2B). Light on VRAM, trains fast on consumer GPUs',
    providers: ['kohya', 'ai-toolkit', 'mock'],
    // Kohya's `anima_train_network.py` takes the DiT, text encoder and VAE as
    // three separate `--flag=path` arguments.
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
    providerComponents: {
      // ai-toolkit builds Anima through its modular diffusers pipeline
      // (`AnimaAutoBlocks().init_pipeline(name_or_path)`), which only accepts a
      // pipeline directory or HF repo id — it cannot assemble the single-file
      // trio above. Hence a separate download of the same model.
      'ai-toolkit': [
        {
          type: 'diffusers',
          label: 'Anima Pipeline Folder',
          required: true,
          downloadId: 'dl-anima-diffusers',
          hint: 'Diffusers pipeline directory — ai-toolkit cannot read the single-file DiT that Kohya uses',
        },
      ],
    },
    tips: [
      'Rank 32 is the community standard for Anima — unlike SDXL, dim 16 tends to underfit',
      'Wants ~2,500–3,500 steps at 1e-4 — one subject sits at the low end, multi-concept sets higher',
      'Batch 2+ trains more reliably than batch 1 (bump the LR if you raise it to 4)',
    ],
    availableResolutions: [512, 768, 1024, 1536],
    hiddenFields: [
      // The Qwen3 text encoder (LLM adapter) stays frozen for Anima, so there's
      // no text-encoder training path to expose.
      'trainTextEncoder',
      'timestepBias',
      'transformerQuantization',
      'textEncoderQuantization',
      // Anima overrides post_process_loss to a no-op and samples noise
      // without an offset — both are DDPM-only mechanisms its flow-matching
      // path never consults (verified against sd-scripts anima_train_network.py).
      'minSnrGamma',
      'noiseOffset',
      // Anima's sample path always uses its internal flow-match Euler;
      // --sample_sampler is accepted by argparse but never consulted.
      'sampleSampler',
    ],
    defaults: {
      ...BASE_DEFAULTS,
      // Trains fast, but not as briefly as its size suggests: 1,600 steps at
      // 5e-5 consistently comes out under-baked. ~2,400–3,200 at 1e-4 lands
      // the concept; 2,800 is the middle of that band.
      steps: 2800,
      epochs: 28,
      learningRate: 1e-4,
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
    hidden: true,
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
    hidden: true,
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
    hidden: true,
    defaults: {
      ...BASE_DEFAULTS,
      networkDim: 32,
      resolution: [512, 768],
    },
  },
];

const ARCHITECTURE_LABELS: Record<ModelArchitecture, string> = {
  flux: 'Flux',
  sdxl: 'Stable Diffusion',
  zimage: 'Z-Image',
  krea2: 'Krea',
  qwenimage: 'Qwen-Image',
  anima: 'Anima',
  wan: 'Wan',
  ltx: 'LTX-Video',
};

export type OptimizerOption = {
  value: string;
  label: string;
  hint: string;
  /**
   * Backends whose environment actually ships this optimiser. Omitted means
   * every backend can run it. Both trainers resolve the optimiser by name at
   * startup and raise if the package is missing, so an option offered to the
   * wrong backend is a run that dies seconds after launch.
   */
  providers?: TrainingProvider[];
};

/**
 * Verified against each backend's optimiser factory and its declared
 * dependencies — `library/optimizer.py` + `requirements.txt` for kohya,
 * `toolkit/optimizer.py` + `requirements_base.txt` for ai-toolkit.
 *
 * Deliberately absent: DAdaptation. Both factories have a branch for it, but
 * neither project depends on the `dadaptation` package, so it was an option
 * that could only ever fail at optimiser construction. Existing saved configs
 * that name it still load (see {@link ADAPTIVE_OPTIMIZERS}) — it just isn't
 * offered any more.
 */
export const OPTIMIZER_OPTIONS: { group: string; items: OptimizerOption[] }[] =
  [
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
      group: 'Self-tuning',
      items: [
        {
          // musubi-tuner's factory falls through to `torch.optim` for names it
          // doesn't special-case, so prodigy (a separate package) can't run
          // there.
          value: 'prodigy',
          label: 'Prodigy',
          hint: 'Finds its own learning rate; start at 1.0',
          providers: ['kohya', 'ai-toolkit'],
        },
        {
          // ai-toolkit's own adaptive optimiser. Unlike Prodigy it treats the LR
          // as a *starting* point and walks it between min_lr/max_lr, so it wants
          // a normal ~1e-4 value — hence it is not an ADAPTIVE_OPTIMIZER here.
          value: 'automagic',
          label: 'Automagic',
          hint: 'Per-parameter adaptive LR, starts from the LR above',
          providers: ['ai-toolkit'],
        },
      ],
    },
    {
      group: 'Memory-efficient',
      items: [
        { value: 'adafactor', label: 'Adafactor', hint: 'Lower VRAM usage' },
      ],
    },
    {
      group: 'Advanced',
      items: [
        { value: 'adamw', label: 'AdamW', hint: 'Standard, more VRAM' },
        {
          // `lion-pytorch` is a kohya requirement; ai-toolkit only raises an
          // ImportError telling you to install it yourself.
          value: 'lion',
          label: 'Lion',
          hint: 'Fast convergence',
          providers: ['kohya'],
        },
      ],
    },
  ];

/**
 * The mock backend fakes a run without touching a GPU. It exists to exercise
 * the job pipeline (progress, checkpoints, samples, the activity panel) and is
 * never something to pick for real training, so it stays out of the Backend
 * dropdown unless `NEXT_PUBLIC_ENABLE_MOCK_TRAINER=true` is set.
 */
const MOCK_TRAINER_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_MOCK_TRAINER === 'true';

/**
 * Backends offerable for a model. `current` is always kept, so a config saved
 * against the mock backend (or a backend since un-set in Settings) still
 * renders its own selection rather than silently showing a different one.
 *
 * `configuredBackends` (provider → has an install folder saved) drops backends
 * that aren't installed — there's nothing to train with, so offering them only
 * invites a failed run. Pass `null`/omit while that's unknown, and when *no*
 * backend for the model is installed the full list comes back so the dropdown
 * isn't empty; the caller warns instead (see {@link getMissingProviders}).
 */
export function getSelectableProviders(
  model: ModelDefinition,
  current: TrainingProvider,
  configuredBackends?: Record<string, boolean> | null,
): TrainingProvider[] {
  const providers = MOCK_TRAINER_ENABLED
    ? model.providers
    : model.providers.filter((p) => p !== 'mock' || p === current);
  if (!configuredBackends) return providers;
  if (hasNoConfiguredProvider(model, configuredBackends)) return providers;
  return providers.filter(
    (p) => p === 'mock' || p === current || configuredBackends[p],
  );
}

/** A model's real (installable) backends — everything bar the mock trainer. */
function realProviders(model: ModelDefinition): TrainingProvider[] {
  return model.providers.filter((p) => p !== 'mock');
}

/**
 * Backends this model can train on that have no install folder saved. Empty
 * when installed-ness is unknown, so an unloaded config never warns.
 */
export function getMissingProviders(
  model: ModelDefinition,
  configuredBackends?: Record<string, boolean> | null,
): TrainingProvider[] {
  if (!configuredBackends) return [];
  return realProviders(model).filter((p) => !configuredBackends[p]);
}

/** Whether no backend this model supports is installed. */
export function hasNoConfiguredProvider(
  model: ModelDefinition,
  configuredBackends?: Record<string, boolean> | null,
): boolean {
  if (!configuredBackends) return false;
  return (
    getMissingProviders(model, configuredBackends).length ===
    realProviders(model).length
  );
}

/** The components a model needs when trained on `provider`. */
export function getModelComponents(
  model: ModelDefinition,
  provider: TrainingProvider,
): ModelComponent[] {
  return model.providerComponents?.[provider] ?? model.components;
}

/**
 * Every component any backend might ask for, deduplicated by type. Used where
 * there is no backend in play — the app-wide model defaults, which pre-fill
 * paths for whichever backend the user later picks.
 */
export function getAllModelComponents(
  model: ModelDefinition,
): ModelComponent[] {
  const byType = new Map<ModelComponentType, ModelComponent>();
  for (const component of [
    ...model.components,
    ...Object.values(model.providerComponents ?? {}).flat(),
  ]) {
    if (!byType.has(component.type)) byType.set(component.type, component);
  }
  return [...byType.values()];
}

export type BackendComponentGroup = {
  /** The real (non-mock) backends that load these components. */
  providers: TrainingProvider[];
  label: string;
  components: ModelComponent[];
};

/**
 * A model's components grouped by the backends that load them, deduplicated —
 * a component every backend shares appears once under a joint title (e.g.
 * "SD Scripts & AI Toolkit"), while backend-specific shapes (Anima's
 * pipeline folder) get their own group.
 */
export function getComponentsByBackend(
  model: ModelDefinition,
): BackendComponentGroup[] {
  const real = model.providers.filter((p) => p !== 'mock');
  const groups = new Map<string, BackendComponentGroup>();
  for (const component of getAllModelComponents(model)) {
    let users = real.filter((provider) =>
      getModelComponents(model, provider).some(
        (c) => c.type === component.type,
      ),
    );
    if (users.length === 0) users = real;
    const key = users.join('+');
    const existing = groups.get(key);
    if (existing) {
      existing.components.push(component);
    } else {
      groups.set(key, {
        providers: users,
        label: users.map((p) => TRAINING_PROVIDER_SHORT_LABELS[p]).join(' & '),
        components: [component],
      });
    }
  }
  return [...groups.values()];
}

/** Optimiser choices the given backend can actually run. */
export function getOptimizerOptions(
  provider: TrainingProvider,
): { group: string; items: OptimizerOption[] }[] {
  return OPTIMIZER_OPTIONS.map((group) => ({
    group: group.group,
    items: group.items.filter(
      // The mock backend runs nothing, so it shows the unfiltered list.
      (item) =>
        provider === 'mock' ||
        !item.providers ||
        item.providers.includes(provider),
    ),
  })).filter((group) => group.items.length > 0);
}

/** Whether `optimizer` is one the backend can run (unknown values pass). */
export function isOptimizerSupported(
  optimizer: string,
  provider: TrainingProvider,
): boolean {
  const option = OPTIMIZER_OPTIONS.flatMap((g) => g.items).find(
    (o) => o.value === optimizer,
  );
  if (!option || !option.providers) return true;
  return provider === 'mock' || option.providers.includes(provider);
}

/**
 * Optimisers that self-tune their effective learning rate *and* expect an LR
 * around 1.0 rather than the ~1e-4 typical for fixed-schedule optimisers
 * (AdamW etc). ai-toolkit silently overrides anything below 0.1 to 1.0 and
 * kohya warns, so a form left at 1e-4 misrepresents what actually trains.
 * Used to auto-adjust the LR on optimiser switch (see training-config slice)
 * and to relabel the LR slider, whose fixed-LR presets don't apply to these.
 *
 * `dadaptation` is retained for configs saved before it was dropped from
 * {@link OPTIMIZER_OPTIONS}.
 */
export const ADAPTIVE_OPTIMIZERS = new Set(['prodigy', 'dadaptation']);

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

/**
 * Pickable models grouped by architecture. Hidden models are excluded unless
 * they are `keepId` — the currently selected model, so a config saved against
 * a since-hidden model still renders its own selection.
 */
export function getModelsByArchitecture(keepId?: string): {
  architecture: ModelArchitecture;
  label: string;
  models: ModelDefinition[];
}[] {
  const groups = new Map<ModelArchitecture, ModelDefinition[]>();
  for (const model of MODEL_DEFINITIONS) {
    if (model.hidden && model.id !== keepId) continue;
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
