/**
 * Downloadable model definitions for training base models.
 *
 * These define HuggingFace sources for checkpoints and their shared
 * dependencies (text encoders, autoencoders, VAEs). The download engine
 * fetches these files and writes .model.json sidecars for scanning.
 *
 * NOTE: Some repos are gated (Flux.1 Dev/Schnell) and require the user
 * to have accepted the license on HuggingFace. If a download returns 401,
 * the UI should explain this and link to the repo.
 */

import type { DownloadableModel } from '../types';

// ---------------------------------------------------------------------------
// Shared components — downloaded once, used by multiple model families
// ---------------------------------------------------------------------------

export const SHARED_COMPONENTS: DownloadableModel[] = [
  // --- Flux.1 / Z-Image text encoders ---
  {
    id: 'shared-t5-xxl',
    name: 'T5-XXL Text Encoder',
    repoId: 'comfyanonymous/flux_text_encoders',
    files: [{ name: 't5xxl_fp16.safetensors', size: 9_787_841_024 }],
    feature: 'training',
    componentType: 't5',
    sharedId: 't5-xxl',
    description: 'Shared text encoder for Flux.1 and Z-Image',
    variants: [
      {
        id: 'fp16',
        label: 'fp16',
        description: 'Full precision — best quality',
        files: [{ name: 't5xxl_fp16.safetensors', size: 9_787_841_024 }],
      },
      {
        id: 'fp8',
        label: 'fp8',
        description: 'Half the size, minimal quality loss',
        files: [{ name: 't5xxl_fp8_e4m3fn.safetensors', size: 4_893_934_904 }],
      },
    ],
  },
  {
    id: 'shared-clip-l',
    name: 'CLIP-L Text Encoder',
    repoId: 'comfyanonymous/flux_text_encoders',
    files: [{ name: 'clip_l.safetensors', size: 246_144_152 }],
    feature: 'training',
    componentType: 'clip_l',
    sharedId: 'clip-l',
    description: 'Shared text encoder for Flux.1 and Z-Image (~235 MB)',
  },

  // --- Flux.1 autoencoder ---
  {
    id: 'shared-flux-ae',
    name: 'Flux.1 Autoencoder',
    repoId: 'black-forest-labs/FLUX.1-dev',
    files: [{ name: 'ae.safetensors', size: 335_304_388 }],
    feature: 'training',
    componentType: 'ae',
    sharedId: 'flux-ae',
    description: 'Shared autoencoder for Flux.1 models (~320 MB)',
    requiresLicense: {
      url: 'https://huggingface.co/black-forest-labs/FLUX.1-dev',
      name: 'FLUX.1 [dev] Non-Commercial',
    },
  },

  // --- Flux.2 text encoder + VAE ---
  {
    id: 'shared-qwen3-8b',
    name: 'Qwen3 8B Text Encoder',
    repoId: 'Comfy-Org/vae-text-encorder-for-flux-klein-9b',
    files: [
      {
        name: 'split_files/text_encoders/qwen_3_8b.safetensors',
        size: 16_400_000_000,
      },
    ],
    feature: 'training',
    componentType: 'qwen',
    sharedId: 'qwen3-8b',
    description: 'Text encoder for Flux.2 Klein models',
    variants: [
      {
        id: 'bf16',
        label: 'bf16',
        description: 'Full precision — best quality',
        files: [
          {
            name: 'split_files/text_encoders/qwen_3_8b.safetensors',
            size: 16_400_000_000,
          },
        ],
      },
      {
        id: 'fp8',
        label: 'fp8',
        description: 'Half the size, minimal quality loss',
        files: [
          {
            name: 'split_files/text_encoders/qwen_3_8b_fp8mixed.safetensors',
            size: 8_660_000_000,
          },
        ],
      },
    ],
  },
  {
    id: 'shared-flux2-vae',
    name: 'Flux.2 VAE',
    repoId: 'Comfy-Org/vae-text-encorder-for-flux-klein-9b',
    files: [
      {
        name: 'split_files/vae/flux2-vae.safetensors',
        size: 336_000_000,
      },
    ],
    feature: 'training',
    componentType: 'ae',
    sharedId: 'flux2-vae',
    description: 'Autoencoder for Flux.2 models (~336 MB)',
  },

  // --- SDXL VAE ---
  {
    id: 'shared-sdxl-vae',
    name: 'SDXL VAE (fp16-fix)',
    repoId: 'madebyollin/sdxl-vae-fp16-fix',
    files: [{ name: 'sdxl_vae.safetensors', size: 334_641_162 }],
    feature: 'training',
    componentType: 'vae',
    sharedId: 'sdxl-vae',
    description: 'Shared VAE for SDXL-based models (~319 MB)',
  },

  // --- Anima text encoder + VAE ---
  // Anima's split files all live in the one circlestone-labs/Anima repo under
  // split_files/. The Kohya (sd-scripts) trainer takes the TE and VAE as
  // separate paths, so we model them as their own components rather than
  // bundling everything into the DiT download.
  {
    id: 'shared-anima-qwen3',
    name: 'Qwen3 0.6B Text Encoder (Anima)',
    repoId: 'circlestone-labs/Anima',
    files: [
      {
        name: 'split_files/text_encoders/qwen_3_06b_base.safetensors',
        size: 1_192_135_096,
      },
    ],
    feature: 'training',
    componentType: 'qwen',
    sharedId: 'anima-qwen3',
    description: 'Qwen3 0.6B text encoder for Anima (~1.2 GB)',
  },
  {
    id: 'shared-anima-vae',
    name: 'Qwen-Image VAE (Anima)',
    repoId: 'circlestone-labs/Anima',
    files: [
      {
        name: 'split_files/vae/qwen_image_vae.safetensors',
        size: 253_806_246,
      },
    ],
    feature: 'training',
    componentType: 'vae',
    sharedId: 'anima-vae',
    description: 'Qwen-Image VAE for Anima (~242 MB)',
  },
];

// ---------------------------------------------------------------------------
// Base model checkpoints
// ---------------------------------------------------------------------------

const FLUX1_DEPS = ['t5-xxl', 'clip-l', 'flux-ae'];
const FLUX2_DEPS = ['qwen3-8b', 'flux2-vae'];
const ANIMA_DEPS = ['anima-qwen3', 'anima-vae'];

const TRAINING_CHECKPOINTS: DownloadableModel[] = [
  // --- Flux.2 family ---
  {
    id: 'dl-flux2-klein-9b',
    name: 'Flux.2 Klein 9B',
    repoId: 'black-forest-labs/FLUX.2-klein-9B',
    files: [{ name: 'flux-2-klein-9b.safetensors', size: 18_200_000_000 }],
    feature: 'training',
    architecture: 'flux',
    componentType: 'checkpoint',
    dependencies: FLUX2_DEPS,
    description: 'Latest generation, practical for home GPUs',
    requiresLicense: {
      url: 'https://huggingface.co/black-forest-labs/FLUX.2-klein-9B',
      name: 'FLUX.2 Klein Non-Commercial',
    },
    variants: [
      {
        id: 'bf16',
        label: 'bf16',
        description: 'Full precision',
        files: [{ name: 'flux-2-klein-9b.safetensors', size: 18_200_000_000 }],
      },
      {
        id: 'fp8',
        label: 'fp8',
        description: 'Half the size, good for <12 GB VRAM',
        files: [
          { name: 'flux-2-klein-9b-fp8.safetensors', size: 9_430_000_000 },
        ],
        repoId: 'black-forest-labs/FLUX.2-klein-9b-fp8',
      },
    ],
  },

  // --- Flux.1 family ---
  {
    id: 'dl-flux-dev',
    name: 'Flux.1 Dev',
    repoId: 'black-forest-labs/FLUX.1-dev',
    files: [{ name: 'flux1-dev.safetensors', size: 23_802_932_552 }],
    feature: 'training',
    architecture: 'flux',
    componentType: 'checkpoint',
    dependencies: FLUX1_DEPS,
    description: 'Best for photorealistic styles',
    requiresLicense: {
      url: 'https://huggingface.co/black-forest-labs/FLUX.1-dev',
      name: 'FLUX.1 [dev] Non-Commercial',
    },
    variants: [
      {
        id: 'bf16',
        label: 'bf16',
        description: 'Full precision',
        files: [{ name: 'flux1-dev.safetensors', size: 23_802_932_552 }],
      },
      {
        id: 'fp8',
        label: 'fp8',
        description: 'Half the size, good for <16 GB VRAM',
        files: [{ name: 'flux1-dev-fp8.safetensors', size: 11_905_822_720 }],
        repoId: 'Kijai/flux-fp8',
      },
    ],
  },
  {
    id: 'dl-flux-schnell',
    name: 'Flux.1 Schnell',
    repoId: 'black-forest-labs/FLUX.1-schnell',
    files: [{ name: 'flux1-schnell.safetensors', size: 23_782_506_688 }],
    feature: 'training',
    architecture: 'flux',
    componentType: 'checkpoint',
    dependencies: FLUX1_DEPS,
    description: 'Fast generation, fewer steps',
    requiresLicense: {
      url: 'https://huggingface.co/black-forest-labs/FLUX.1-schnell',
      name: 'Apache 2.0',
    },
    variants: [
      {
        id: 'bf16',
        label: 'bf16',
        description: 'Full precision',
        files: [{ name: 'flux1-schnell.safetensors', size: 23_782_506_688 }],
      },
      {
        id: 'fp8',
        label: 'fp8',
        description: 'Half the size, good for <16 GB VRAM',
        files: [
          {
            name: 'flux1-schnell-fp8.safetensors',
            size: 11_895_395_904,
          },
        ],
        repoId: 'Kijai/flux-fp8',
      },
    ],
  },

  // --- SDXL family ---
  {
    id: 'dl-sdxl-base',
    name: 'Stable Diffusion XL 1.0',
    repoId: 'stabilityai/stable-diffusion-xl-base-1.0',
    files: [{ name: 'sd_xl_base_1.0.safetensors', size: 6_938_078_334 }],
    feature: 'training',
    architecture: 'sdxl',
    componentType: 'checkpoint',
    dependencies: ['sdxl-vae'],
    description: 'Mature ecosystem, wide compatibility (~6.5 GB)',
  },
  {
    id: 'dl-illustrious-xl',
    name: 'Illustrious XL v2.0',
    repoId: 'OnomaAIResearch/Illustrious-XL-v2.0',
    files: [{ name: 'Illustrious-XL-v2.0.safetensors', size: 6_938_040_674 }],
    feature: 'training',
    architecture: 'sdxl',
    componentType: 'checkpoint',
    dependencies: ['sdxl-vae'],
    description: 'Illustration-focused SDXL base model (~6.5 GB)',
  },
  {
    id: 'dl-noob-xl',
    name: 'NoobAI XL 1.1',
    repoId: 'Laxhar/noobai-XL-1.1',
    files: [{ name: 'NoobAI-XL-v1.1.safetensors', size: 7_105_349_958 }],
    feature: 'training',
    architecture: 'sdxl',
    componentType: 'checkpoint',
    dependencies: ['sdxl-vae'],
    description: 'Anime/illustration SDXL, non-vpred variant (~6.6 GB)',
  },

  // --- Anima ---
  // Anima is anime-focused, Cosmos-Predict2-based, ~2B params. Trained via the
  // Kohya (sd-scripts) `anima_train_network.py` backend. The DiT, Qwen3 text
  // encoder, and Qwen-Image VAE all download from the one HF repo.
  //
  // Licensed under the CircleStone Labs Non-Commercial License (weights only;
  // generated images are unrestricted). The repo is public, so no gated-repo
  // acceptance is needed to download.
  {
    id: 'dl-anima-dit',
    name: 'Anima DiT (base v1.0)',
    repoId: 'circlestone-labs/Anima',
    files: [
      {
        name: 'split_files/diffusion_models/anima-base-v1.0.safetensors',
        size: 4_182_218_328,
      },
    ],
    feature: 'training',
    architecture: 'anima',
    componentType: 'checkpoint',
    dependencies: ANIMA_DEPS,
    description: 'Anime-focused ~2B DiT — low VRAM, fast to train (~4 GB)',
  },

  // --- Z-Image ---
  // Z-Image Turbo ships as a full diffusers pipeline directory: the
  // transformer, text encoder, VAE, tokenizer, and scheduler all live in
  // one HF repo under well-known subfolders, so we bundle every file
  // under one download rather than splitting into shared components —
  // the text encoder (Qwen3-4B) isn't reused by any other model yet.
  //
  // Stored fp32 even though it runs in bf16 — this is the loader-compatible
  // base ai-toolkit trains against.
  {
    id: 'dl-zimage-turbo',
    name: 'Z-Image Turbo',
    repoId: 'Tongyi-MAI/Z-Image-Turbo',
    feature: 'training',
    architecture: 'zimage',
    componentType: 'checkpoint',
    description: 'Fast DiT with Qwen3-4B text encoder (~32.8 GB)',
    files: [
      { name: 'model_index.json', size: 467 },
      { name: 'scheduler/scheduler_config.json', size: 173 },
      { name: 'transformer/config.json', size: 473 },
      {
        name: 'transformer/diffusion_pytorch_model.safetensors.index.json',
        size: 48_969,
      },
      {
        name: 'transformer/diffusion_pytorch_model-00001-of-00003.safetensors',
        size: 9_973_693_184,
      },
      {
        name: 'transformer/diffusion_pytorch_model-00002-of-00003.safetensors',
        size: 9_973_714_824,
      },
      {
        name: 'transformer/diffusion_pytorch_model-00003-of-00003.safetensors',
        size: 4_672_282_880,
      },
      { name: 'text_encoder/config.json', size: 726 },
      { name: 'text_encoder/generation_config.json', size: 239 },
      {
        name: 'text_encoder/model.safetensors.index.json',
        size: 32_819,
      },
      {
        name: 'text_encoder/model-00001-of-00003.safetensors',
        size: 3_957_900_840,
      },
      {
        name: 'text_encoder/model-00002-of-00003.safetensors',
        size: 3_987_450_520,
      },
      {
        name: 'text_encoder/model-00003-of-00003.safetensors',
        size: 99_630_640,
      },
      { name: 'vae/config.json', size: 805 },
      {
        name: 'vae/diffusion_pytorch_model.safetensors',
        size: 167_666_902,
      },
      { name: 'tokenizer/tokenizer_config.json', size: 9_732 },
      { name: 'tokenizer/tokenizer.json', size: 11_422_654 },
      { name: 'tokenizer/merges.txt', size: 1_671_853 },
      { name: 'tokenizer/vocab.json', size: 2_776_833 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Combined registry
// ---------------------------------------------------------------------------

export const ALL_TRAINING_MODELS: DownloadableModel[] = [
  ...SHARED_COMPONENTS,
  ...TRAINING_CHECKPOINTS,
];

/**
 * Look up a training downloadable model by ID.
 */
export function getTrainingDownloadable(
  id: string,
): DownloadableModel | undefined {
  return ALL_TRAINING_MODELS.find((m) => m.id === id);
}

/**
 * Get all downloadable models (checkpoint + dependencies) needed for a
 * given training model architecture.
 */
export function getDownloadablesForArchitecture(architecture: string): {
  checkpoints: DownloadableModel[];
  dependencies: DownloadableModel[];
} {
  const checkpoints = TRAINING_CHECKPOINTS.filter(
    (m) => m.architecture === architecture,
  );

  // Collect unique dependency sharedIds
  const depIds = new Set<string>();
  for (const cp of checkpoints) {
    for (const dep of cp.dependencies ?? []) {
      depIds.add(dep);
    }
  }

  const dependencies = SHARED_COMPONENTS.filter((m) => depIds.has(m.sharedId!));

  return { checkpoints, dependencies };
}
