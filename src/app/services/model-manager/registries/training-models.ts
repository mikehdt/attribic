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

const SHARED_COMPONENTS: DownloadableModel[] = [
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
        size: 16_381_517_176,
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
            size: 16_381_517_176,
          },
        ],
      },
      {
        id: 'fp8',
        label: 'fp8',
        description:
          'Half the size, minimal quality loss (ai-toolkit only — Musubi needs bf16)',
        files: [
          {
            name: 'split_files/text_encoders/qwen_3_8b_fp8mixed.safetensors',
            size: 8_664_848_742,
          },
        ],
      },
    ],
  },
  {
    id: 'shared-flux2-vae',
    name: 'Flux.2 VAE',
    repoId: 'Comfy-Org/vae-text-encorder-for-flux-klein-9b',
    // Byte-identical to BFL's gated `ae.safetensors`, in the original (non-
    // diffusers) key layout — so it also serves as musubi-tuner's `--vae`
    // for the Klein Base models (its strict loader wants exactly this shape,
    // `bn.running_*` keys included — verified against the file header).
    files: [
      {
        name: 'split_files/vae/flux2-vae.safetensors',
        size: 336_211_292,
      },
    ],
    feature: 'training',
    componentType: 'ae',
    sharedId: 'flux2-vae',
    description: 'Autoencoder for Flux.2 models (~320 MB)',
  },

  // --- Z-Image Base components (musubi-tuner) ---
  // Musubi loads the DiT, VAE and text encoder as three separate single-file
  // paths, so unlike the Turbo diffusers pipeline these are split components.
  // Sourced from Comfy-Org's repackage of Tongyi-MAI/Z-Image because it ships
  // each part as ONE .safetensors file — the official repo shards the DiT and
  // TE. bf16 only: musubi quantises to fp8 at runtime (--fp8_base/--fp8_llm)
  // and rejects pre-quantised fp8 repacks outright.
  {
    id: 'shared-zimage-vae',
    name: 'Z-Image VAE',
    repoId: 'Comfy-Org/z_image',
    files: [{ name: 'split_files/vae/ae.safetensors', size: 335_304_388 }],
    feature: 'training',
    componentType: 'vae',
    sharedId: 'zimage-vae',
    description: 'Autoencoder shared by Z-Image Base and Turbo (~320 MB)',
  },
  {
    id: 'shared-zimage-qwen3',
    name: 'Qwen3 4B Text Encoder (Z-Image)',
    repoId: 'Comfy-Org/z_image',
    files: [
      {
        name: 'split_files/text_encoders/qwen_3_4b.safetensors',
        size: 8_044_982_048,
      },
    ],
    feature: 'training',
    componentType: 'qwen',
    sharedId: 'zimage-qwen3',
    description: 'Qwen3 4B text encoder for Z-Image (~7.5 GB, bf16)',
  },

  // --- Qwen-Image family components (musubi-tuner) ---
  // The Qwen-Image VAE serves three musubi archs: Qwen-Image itself, Krea 2
  // (which reuses it wholesale), and — as a separate registration — Anima's
  // copy below. Anima keeps its own entry: it predates this one, downloads
  // from the Anima repo alongside its other split files, and re-pointing it
  // would orphan existing installs.
  {
    id: 'shared-qwen-image-vae',
    name: 'Qwen-Image VAE',
    repoId: 'Comfy-Org/Qwen-Image_ComfyUI',
    files: [
      {
        name: 'split_files/vae/qwen_image_vae.safetensors',
        size: 253_806_246,
      },
    ],
    feature: 'training',
    componentType: 'vae',
    sharedId: 'qwen-image-vae',
    description: 'Autoencoder shared by Qwen-Image and Krea 2 (~242 MB)',
  },
  {
    id: 'shared-qwen25vl-7b',
    name: 'Qwen2.5-VL 7B Text Encoder',
    repoId: 'Comfy-Org/Qwen-Image_ComfyUI',
    files: [
      {
        name: 'split_files/text_encoders/qwen_2.5_vl_7b.safetensors',
        size: 16_584_415_576,
      },
    ],
    feature: 'training',
    componentType: 'qwen',
    sharedId: 'qwen25vl-7b',
    description: 'Qwen2.5-VL 7B text encoder for Qwen-Image (~15.4 GB, bf16)',
  },

  // --- Krea 2 text encoder ---
  // Qwen3-VL 4B — a *vision-language* Qwen3, distinct from the text-only
  // Qwen3 4B that Z-Image and Flux.2 Klein 4B share.
  {
    id: 'shared-qwen3vl-4b',
    name: 'Qwen3-VL 4B Text Encoder',
    repoId: 'Comfy-Org/Qwen3-VL',
    files: [
      {
        name: 'text_encoders/qwen3vl_4b_bf16.safetensors',
        size: 8_875_719_384,
      },
    ],
    feature: 'training',
    componentType: 'qwen',
    sharedId: 'qwen3vl-4b',
    description: 'Qwen3-VL 4B text encoder for Krea 2 (~8.3 GB, bf16)',
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
      name: 'Flux.2 Klein Non-Commercial',
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
  // ai-toolkit loads Anima through its modular diffusers pipeline
  // (`AnimaAutoBlocks().init_pipeline`), which reads `modular_model_index.json`
  // and the named subfolders below — it has no single-file loader, so the
  // split weights above are no use to it and this is a second copy of the same
  // model. Deliberately no `dependencies`: the pipeline bundles its own text
  // encoder and VAE, so the shared Anima components aren't needed here.
  //
  // Lands beside the split files in models/anima/ — they occupy disjoint
  // subpaths, the download engine only ever deletes files from its own
  // manifest, and diffusers ignores directory entries it doesn't recognise.
  // Same coexistence arrangement as the Z-Image training adapter below.
  {
    id: 'dl-anima-diffusers',
    name: 'Anima Pipeline (base v1.0, diffusers)',
    repoId: 'circlestone-labs/Anima-Base-v1.0-Diffusers',
    feature: 'training',
    architecture: 'anima',
    componentType: 'diffusers',
    description: 'Anima as a diffusers pipeline, for ai-toolkit (~5.6 GB)',
    files: [
      { name: 'modular_model_index.json', size: 2_414 },
      { name: 'scheduler/scheduler_config.json', size: 487 },
      { name: 'transformer/config.json', size: 728 },
      {
        name: 'transformer/diffusion_pytorch_model.safetensors',
        size: 3_912_877_104,
      },
      { name: 'text_encoder/config.json', size: 1_409 },
      { name: 'text_encoder/model.safetensors', size: 1_192_133_232 },
      { name: 'text_conditioner/config.json', size: 333 },
      {
        name: 'text_conditioner/diffusion_pytorch_model.safetensors',
        size: 269_339_400,
      },
      { name: 'vae/config.json', size: 753 },
      { name: 'vae/diffusion_pytorch_model.safetensors', size: 253_806_966 },
      { name: 'tokenizer/tokenizer.json', size: 11_422_924 },
      { name: 'tokenizer/tokenizer_config.json', size: 421 },
      { name: 'tokenizer/chat_template.jinja', size: 2_427 },
      { name: 't5_tokenizer/tokenizer.json', size: 2_424_069 },
      { name: 't5_tokenizer/tokenizer_config.json', size: 2_439 },
    ],
  },

  // --- Z-Image Base DiT (musubi-tuner) ---
  // Lands in models/zimage/ beside the Turbo pipeline and adapter — its
  // split_files/ subpath is disjoint from theirs, and the download engine only
  // ever deletes files from its own manifest, so all three coexist.
  {
    id: 'dl-zimage-base-dit',
    name: 'Z-Image Base DiT',
    repoId: 'Comfy-Org/z_image',
    files: [
      {
        name: 'split_files/diffusion_models/z_image_bf16.safetensors',
        size: 12_309_866_400,
      },
    ],
    feature: 'training',
    architecture: 'zimage',
    componentType: 'checkpoint',
    dependencies: ['zimage-vae', 'zimage-qwen3'],
    description:
      'Undistilled Z-Image base for LoRA training (~11.5 GB, bf16 only)',
  },

  // --- Flux.2 Klein Base (musubi-tuner) ---
  // The undistilled training bases. Both are single-file DiTs at the repo
  // root; the TE and AE come from the shared components the distilled Klein
  // 9B / Z-Image entries already register (musubi's loaders read the same
  // Comfy-Org single-file weights). 4B is public Apache 2.0; 9B is gated.
  {
    id: 'dl-flux2-klein-base-4b',
    name: 'Flux.2 Klein Base 4B',
    repoId: 'black-forest-labs/FLUX.2-klein-base-4B',
    files: [{ name: 'flux-2-klein-base-4b.safetensors', size: 7_751_105_712 }],
    feature: 'training',
    architecture: 'flux',
    componentType: 'checkpoint',
    dependencies: ['zimage-qwen3', 'flux2-vae'],
    description: 'Undistilled Klein 4B for LoRA training (~7.2 GB)',
  },
  {
    id: 'dl-flux2-klein-base-9b',
    name: 'Flux.2 Klein Base 9B',
    repoId: 'black-forest-labs/FLUX.2-klein-base-9B',
    files: [{ name: 'flux-2-klein-base-9b.safetensors', size: 18_157_185_168 }],
    feature: 'training',
    architecture: 'flux',
    componentType: 'checkpoint',
    dependencies: ['qwen3-8b', 'flux2-vae'],
    description: 'Undistilled Klein 9B for LoRA training (~17 GB)',
    requiresLicense: {
      url: 'https://huggingface.co/black-forest-labs/FLUX.2-klein-base-9B',
      name: 'FLUX.2 Klein Non-Commercial',
    },
  },

  // --- Krea 2 (musubi-tuner + ai-toolkit) ---
  // The RAW (undistilled) DiT both backends train against. ai-toolkit loads
  // this same single file and fetches its own TE/VAE copies from HF at run
  // time; musubi takes the shared Qwen3-VL 4B and Qwen-Image VAE components.
  {
    id: 'dl-krea2-raw',
    name: 'Krea 2 RAW',
    repoId: 'krea/Krea-2-Raw',
    files: [{ name: 'raw.safetensors', size: 26_283_332_608 }],
    feature: 'training',
    architecture: 'krea2',
    componentType: 'checkpoint',
    dependencies: ['qwen-image-vae', 'qwen3vl-4b'],
    description: 'Undistilled Krea 2 DiT for LoRA training (~24.5 GB)',
    requiresLicense: {
      url: 'https://huggingface.co/krea/Krea-2-Raw',
      name: 'Krea 2 Community Licence',
    },
  },

  // --- Qwen-Image (musubi-tuner) ---
  // bf16 only — musubi quantises to fp8 at runtime (--fp8_base/--fp8_scaled/
  // --fp8_vl) and rejects the pre-quantised fp8 releases outright.
  {
    id: 'dl-qwen-image-dit',
    name: 'Qwen-Image DiT',
    repoId: 'Comfy-Org/Qwen-Image_ComfyUI',
    files: [
      {
        name: 'split_files/diffusion_models/qwen_image_bf16.safetensors',
        size: 40_861_031_488,
      },
    ],
    feature: 'training',
    architecture: 'qwenimage',
    componentType: 'checkpoint',
    dependencies: ['qwen25vl-7b', 'qwen-image-vae'],
    description: '20B Qwen-Image DiT for LoRA training (~38 GB, bf16 only)',
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
  // Z-Image Turbo is guidance/step-distilled, so its velocity field is
  // collapsed and a LoRA trained directly against it barely moves — the
  // weights grow but the result is inert at any strength. That problem is the
  // base model's, not any one trainer's; this adapter is *ai-toolkit's* answer
  // to it. It merges the adapter in at +1.0 for the duration of training to
  // de-distil the transformer, then applies it at -1.0 while sampling to undo
  // it (`invert_assistant_lora`), leaving only the trained LoRA in the saved
  // weights. Their other route is the separately de-distilled
  // `ostris/Z-Image-De-Turbo` base, which needs no adapter. A different backend
  // would need its own approach — this file is not it.
  //
  // Lands beside the base pipeline in models/zimage/ — the download engine
  // only ever deletes files listed in its own manifest, so the two coexist,
  // and diffusers ignores stray files in a pipeline root.
  {
    id: 'dl-zimage-turbo-adapter',
    name: 'Z-Image Turbo Training Adapter',
    repoId: 'ostris/zimage_turbo_training_adapter',
    feature: 'training',
    architecture: 'zimage',
    componentType: 'training_adapter',
    description: 'De-distils Z-Image Turbo for ai-toolkit training (~340 MB)',
    files: [
      {
        name: 'zimage_turbo_training_adapter_v2.safetensors',
        size: 340_194_488,
      },
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
