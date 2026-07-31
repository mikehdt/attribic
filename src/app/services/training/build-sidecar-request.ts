/**
 * Server-only: translate the client-side training form config into the
 * snake_case shape the Python sidecar expects. Resolves absolute paths
 * against the projectsFolder in config.json.
 */

import path from 'path';

import { getProjectsFolder } from '@/app/services/config/server-config';

import {
  type CaptionEmission,
  captionPreferenceForModel,
} from './caption-emission';
import {
  defaultSampleAspect,
  getSampleBase,
  resolveSampleSize,
  type SampleAspect,
} from './sample-sizes';
import { getLoraOutputRoot } from './training-root';

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
  detectedRepeats: number;
  overrideRepeats: number | null;
  loraWeight: number;
  isRegularization: boolean;
} & ClientFolderAugmentation;

type ClientDatasetSource = {
  folderName: string;
  /** The user's pin, or null/absent to follow the model's preference. */
  captionEmission?: CaptionEmission | null;
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
  caption_emission: CaptionEmission;
};

/**
 * Resolve each dataset's caption emission and fan it across its folders.
 *
 * Deliberately unconditional — no check of the project's caption mode. The
 * sidecar decides per file, by whether the `.txt` carries a hybrid delimiter,
 * so an emission on a tags-only or caption-only project is a no-op by
 * construction. Reading the caption mode here would only let a stale reading
 * disagree with the file that is about to be read anyway.
 */
function buildDatasets(
  datasets: ClientDatasetSource[],
  extraFolders: ClientExtraFolder[],
  projectsFolder: string,
  modelId: string,
) {
  const entries: SidecarDatasetEntry[] = [];
  // Extra folders have no project and so no pin; they follow the model.
  const modelPreference = captionPreferenceForModel(modelId);

  for (const ds of datasets) {
    const captionEmission = ds.captionEmission ?? modelPreference;
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
        caption_emission: captionEmission,
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
      caption_emission: modelPreference,
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
  sample_sizes: [number, number][];
  project?: { id?: string; name: string; version: number };
  form_snapshot?: Record<string, unknown>;
  client_config?: Record<string, unknown>;
} {
  const projectsFolder = getProjectsFolder();

  const datasets = buildDatasets(
    (config.datasets as ClientDatasetSource[]) ?? [],
    (config.extraFolders as ClientExtraFolder[]) ?? [],
    projectsFolder,
    (config.modelId as string) ?? '',
  );

  const outputName = (config.outputName as string) || 'unnamed-lora';
  // Put outputs in a single shared `loras` folder off the configured training
  // folder, otherwise fall back inside the training root. Uses the shared
  // resolver so the UI's "Output folder" display matches what gets written.
  const firstDataset = (config.datasets as ClientDatasetSource[])?.[0];
  const outputPath = getLoraOutputRoot();

  // Project path: best-effort — the first dataset's folder, else cwd.
  const projectPath =
    firstDataset && projectsFolder
      ? path.join(projectsFolder, firstDataset.folderName)
      : process.cwd();

  // Translate the ai-toolkit-relevant hyperparameters from camelCase to
  // the snake_case names the provider reads from the hyperparameters dict.
  const modelPaths = (config.modelPaths as Record<string, string>) ?? {};
  // The flat `model_path` is what ai-toolkit passes straight to `name_or_path`.
  // A `diffusers` component wins over `checkpoint` because a model offering
  // both (Anima) keeps a path in each — the single-file one belongs to kohya,
  // which reads `model_paths.checkpoint` directly and only falls back to this.
  const checkpointPath = modelPaths.diffusers || modelPaths.checkpoint;

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

  // Sampling cadence mirrors the save-cadence dual field: the user picks one
  // unit, and the sidecar reads whichever is non-zero. Kohya passes
  // --sample_every_n_epochs natively; the ai-toolkit provider converts epochs
  // to steps. The inactive unit is zeroed here so exactly one wins.
  const samplingEnabled = (config.samplingEnabled as boolean) ?? false;
  const sampleMode = (config.sampleMode as string) ?? 'steps';
  const sampleEveryEpochs = (config.sampleEveryEpochs as number) ?? 1;
  const sampleEverySteps = (config.sampleEverySteps as number) ?? 250;
  const sampleEveryNEpochs =
    samplingEnabled && sampleMode === 'epochs' ? sampleEveryEpochs : 0;
  const sampleEveryNSteps =
    samplingEnabled && sampleMode === 'steps' ? sampleEverySteps : 0;

  const hyperparameters: Record<string, unknown> = {
    // `steps` is authoritative in steps-mode; in epochs-mode it's a converted
    // estimate and `epochs` is authoritative. Providers that can count epochs
    // natively (Kohya) read duration_mode and drive off `epochs`; step-only
    // backends (ai-toolkit) use the converted `steps` regardless.
    duration_mode: (config.durationMode as string) ?? 'steps',
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
    native_resolution: config.nativeResolution,
    seed: config.seed,
    guidance_scale: config.guidanceScale,
    sample_steps: config.sampleSteps,
    sample_sampler: config.sampleSampler,
    sample_every_n_epochs: sampleEveryNEpochs,
    sample_every_n_steps: sampleEveryNSteps,
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
    diff_output_preservation_multiplier:
      config.diffOutputPreservationMultiplier,
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

  // Per-prompt image shape, resolved from aspect keys to pixels here because
  // only the client knows the run's resolution settings. Index-aligned with
  // sample_prompts; the sidecar turns each pair into `--w`/`--h` flags on the
  // prompt line, which both backends parse.
  const samplePrompts = samplingEnabled
    ? ((config.samplePrompts as string[]) ?? [])
    : [];
  const sampleBase = getSampleBase(
    config.resolution as number[] | number | undefined,
    config.nativeResolution as string | undefined,
  );
  const sampleAspects = (config.samplePromptSizes as SampleAspect[]) ?? [];
  const fallbackAspect = defaultSampleAspect(sampleBase);
  const sampleSizes: [number, number][] = samplePrompts.map((_, i) =>
    resolveSampleSize(sampleAspects[i] ?? fallbackAspect, sampleBase),
  );

  return {
    project_path: projectPath,
    provider: (config.provider as string) ?? 'ai-toolkit',
    base_model: (config.modelId as string) ?? 'sdxl',
    output_path: outputPath,
    output_name: outputName,
    datasets,
    hyperparameters,
    // Providers enable sampling purely on a non-empty prompt list, so the
    // toggle must clear it — prompts persist in Redux while the section is off.
    sample_prompts: samplePrompts,
    sample_sizes: sampleSizes,
    // Client-owned metadata, forwarded so the sidecar's record of the run is
    // complete enough to rebuild the client's whole view of it. Without these a
    // run recovered from the sidecar comes back with no project attached — and
    // the project menu's run list, which filters on exactly that, silently
    // drops it — and with a config rebuilt lossily from the fields above.
    // None is consumed by any provider; the sidecar stores them verbatim.
    project: config.project as
      { id?: string; name: string; version: number } | undefined,
    form_snapshot: config.formSnapshot as Record<string, unknown> | undefined,
    client_config: config.clientConfig as Record<string, unknown> | undefined,
  };
}
