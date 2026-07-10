/**
 * Server-only: translate the client-side training form config into the
 * snake_case shape the Python sidecar expects. Resolves absolute paths
 * against the projectsFolder in config.json.
 */

import path from 'path';

import { getProjectsFolder } from '@/app/services/config/server-config';

import { resolveLoraOutputDir } from './output-path';

type ClientFormConfig = Record<string, unknown>;

type ClientFolderAugmentation = {
  captionShuffling: boolean;
  keepTokens: number;
  captionDropoutRate: number;
  flipAugment: boolean;
  flipVAugment: boolean;
};

type ClientDatasetFolder = {
  name: string;
  imageCount: number;
  detectedRepeats: number;
  overrideRepeats: number | null;
  loraWeight: number;
  isRegularization: boolean;
} & ClientFolderAugmentation;

type ClientDatasetSource = {
  folderName: string;
  folders: ClientDatasetFolder[];
};

type ClientExtraFolder = {
  path: string;
  overrideRepeats: number | null;
  loraWeight: number;
  isRegularization: boolean;
} & ClientFolderAugmentation;

type SidecarDatasetEntry = {
  path: string;
  num_repeats: number;
  lora_weight: number;
  is_regularization: boolean;
  caption_shuffling: boolean;
  keep_tokens: number;
  caption_dropout_rate: number;
  flip_augment: boolean;
  flip_v_augment: boolean;
};

function buildDatasets(
  datasets: ClientDatasetSource[],
  extraFolders: ClientExtraFolder[],
  projectsFolder: string,
) {
  const entries: SidecarDatasetEntry[] = [];

  for (const ds of datasets) {
    for (const folder of ds.folders) {
      const repeats = folder.overrideRepeats ?? folder.detectedRepeats;
      if (repeats <= 0) continue;
      // "Root" is a display-only sentinel from getProjectFolders meaning
      // "images live directly in the project folder, no subdir" — strip it
      // so the absolute path points at the project folder itself, not a
      // nonexistent F:\...\project\Root directory.
      const subfolder = folder.name === 'Root' ? '' : folder.name;
      const folderPath = projectsFolder
        ? path.join(projectsFolder, ds.folderName, subfolder)
        : path.join(ds.folderName, subfolder);
      entries.push({
        path: folderPath,
        num_repeats: repeats,
        lora_weight: folder.loraWeight,
        is_regularization: folder.isRegularization,
        caption_shuffling: folder.captionShuffling,
        keep_tokens: folder.keepTokens,
        caption_dropout_rate: folder.captionDropoutRate,
        flip_augment: folder.flipAugment,
        flip_v_augment: folder.flipVAugment,
      });
    }
  }

  for (const extra of extraFolders) {
    const repeats = extra.overrideRepeats ?? 1;
    if (repeats <= 0) continue;
    entries.push({
      path: extra.path,
      num_repeats: repeats,
      lora_weight: extra.loraWeight,
      is_regularization: extra.isRegularization,
      caption_shuffling: extra.captionShuffling,
      keep_tokens: extra.keepTokens,
      caption_dropout_rate: extra.captionDropoutRate,
      flip_augment: extra.flipAugment,
      flip_v_augment: extra.flipVAugment,
    });
  }

  return entries;
}

/**
 * Build a StartJobRequest body for POST /jobs/start from the raw client
 * form config. Paths are resolved relative to the configured projects
 * folder so the sidecar receives absolute paths.
 */
export function buildSidecarStartRequest(config: ClientFormConfig): {
  project_path: string;
  provider: string;
  base_model: string;
  output_path: string;
  output_name: string;
  datasets: SidecarDatasetEntry[];
  hyperparameters: Record<string, unknown>;
  sample_prompts: string[];
} {
  const projectsFolder = getProjectsFolder();

  const datasets = buildDatasets(
    (config.datasets as ClientDatasetSource[]) ?? [],
    (config.extraFolders as ClientExtraFolder[]) ?? [],
    projectsFolder,
  );

  const outputName = (config.outputName as string) || 'unnamed-lora';
  // Put outputs in a single shared `loras` folder off the configured training
  // folder, otherwise fall back to .training/outputs. Uses the shared resolver
  // so the UI's "Output folder" display matches what actually gets written.
  const firstDataset = (config.datasets as ClientDatasetSource[])?.[0];
  const outputPath =
    resolveLoraOutputDir(projectsFolder) ??
    path.join(process.cwd(), '.training', 'outputs');

  // Project path: best-effort — the first dataset's folder, else cwd.
  const projectPath =
    firstDataset && projectsFolder
      ? path.join(projectsFolder, firstDataset.folderName)
      : process.cwd();

  // Translate the ai-toolkit-relevant hyperparameters from camelCase to
  // the snake_case names the provider reads from the hyperparameters dict.
  const modelPaths = (config.modelPaths as Record<string, string>) ?? {};
  const checkpointPath = modelPaths.checkpoint;

  const saveEnabled = (config.saveEnabled as boolean) ?? false;
  const saveMode = (config.saveMode as string) ?? 'epochs';
  const saveEveryEpochs = (config.saveEveryEpochs as number) ?? 1;
  const saveEverySteps = (config.saveEverySteps as number) ?? 100;
  // The save cadence is expressed in exactly one unit. The sidecar reads
  // whichever field is non-zero (steps take precedence) and treats 0/0 as
  // "saving disabled". Send the user's chosen unit as-is instead of collapsing
  // a step interval into epochs, which silently dropped it.
  const saveEveryNEpochs =
    saveEnabled && saveMode === 'epochs' ? saveEveryEpochs : 0;
  const saveEveryNSteps =
    saveEnabled && saveMode === 'steps' ? saveEverySteps : 0;

  const hyperparameters: Record<string, unknown> = {
    steps: config.steps,
    epochs: config.epochs,
    lr: config.learningRate,
    optimizer: config.optimizer,
    scheduler: config.scheduler,
    warmup_steps: config.warmupSteps,
    num_restarts: config.numRestarts,
    weight_decay: config.weightDecay,
    max_grad_norm: config.maxGradNorm,
    train_text_encoder: config.trainTextEncoder,
    backbone_lr: config.backboneLR,
    text_encoder_lr: config.textEncoderLR,
    ema: config.ema,
    ema_decay: config.emaDecay,
    loss_type: config.lossType,
    timestep_type: config.timestepType,
    timestep_bias: config.timestepBias,
    discrete_flow_shift: config.discreteFlowShift,
    min_snr_gamma: config.minSnrGamma,
    noise_offset: config.noiseOffset,
    batch_size: config.batchSize,
    network_type: config.networkType,
    network_dim: config.networkDim,
    network_alpha: config.networkAlpha,
    network_dropout: config.networkDropout,
    scale_weight_norms: config.scaleWeightNorms,
    resolution: config.resolution,
    mixed_precision: config.mixedPrecision,
    transformer_quantization: config.transformerQuantization,
    text_encoder_quantization: config.textEncoderQuantization,
    cache_text_embeddings: config.cacheTextEmbeddings,
    unload_text_encoder: config.unloadTextEncoder,
    gradient_accumulation_steps: config.gradientAccumulationSteps,
    gradient_checkpointing: config.gradientCheckpointing,
    cache_latents: config.cacheLatents,
    bucket_reso_steps: config.bucketResoSteps,
    bucket_no_upscale: config.bucketNoUpscale,
    seed: config.seed,
    guidance_scale: config.guidanceScale,
    sample_steps: config.sampleSteps,
    sample_sampler: config.sampleSampler,
    sample_every_n_steps: config.sampleEverySteps,
    save_every_n_epochs: saveEveryNEpochs,
    save_every_n_steps: saveEveryNSteps,
    save_format: config.saveFormat,
    max_saves_to_keep: config.maxSavesToKeep,
    save_state: config.saveState,
    resume_state: config.resumeState || undefined,
    // Expert-tier extras. Kohya-only: raw arg strings + block swap.
    network_args: config.networkArgs,
    optimizer_args: config.optimizerArgs,
    blocks_to_swap: config.blocksToSwap,
    // ai-toolkit-only expert extras.
    lokr_factor: config.lokrFactor,
    content_or_style: config.contentOrStyle,
    diff_output_preservation: config.diffOutputPreservation,
    diff_output_preservation_multiplier: config.diffOutputPreservationMultiplier,
    diff_output_preservation_class: config.diffOutputPreservationClass,
    layer_targeting: config.layerTargeting,
    low_vram: config.lowVram,
    // Pass through the user-selected checkpoint path so the sidecar uses
    // the local file rather than the registry's default HF URL.
    model_path: checkpointPath,
    // Full per-component path map (keyed by component type: checkpoint, qwen,
    // vae, t5, clip_l, ae). Backends that need more than the checkpoint —
    // e.g. Kohya/Anima wants explicit DiT + Qwen3 + VAE paths — read from here.
    model_paths: modelPaths,
  };

  return {
    project_path: projectPath,
    provider: (config.provider as string) ?? 'ai-toolkit',
    base_model: (config.modelId as string) ?? 'sdxl',
    output_path: outputPath,
    output_name: outputName,
    datasets,
    hyperparameters,
    sample_prompts: (config.samplePrompts as string[]) ?? [],
  };
}
