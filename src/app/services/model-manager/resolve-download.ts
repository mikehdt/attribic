/**
 * Resolve a model id (+ optional variant) into a concrete download.
 *
 * The model registries are TypeScript and stay that way — the sidecar that
 * runs downloads knows nothing about model ids, variants or folder
 * conventions. This turns a registry entry into the repo, file list and target
 * directory the sidecar actually needs.
 *
 * Shared by the download route's POST (start) and DELETE (clean up) so the two
 * can never disagree about where a model's files live.
 *
 * Server-only — do not import from client components.
 */

import path from 'path';

import { getModel } from '@/app/services/auto-tagger';
import { getModelDir } from '@/app/services/auto-tagger/model-manager';
import { getModelsFolder } from '@/app/services/config/server-config';

import { taggerModelToDownloadable } from './registries/auto-tagger-models';
import { getTrainingDownloadable } from './registries/training-models';
import type { DownloadableModel, ModelSidecar } from './types';

export type ResolvedDownload = {
  model: DownloadableModel;
  targetDir: string;
};

/**
 * Where a training model's files go. Shared components are deduplicated into
 * one folder; everything else is filed by architecture.
 */
function trainingTargetDir(model: DownloadableModel): string {
  const modelsFolder = getModelsFolder();
  if (model.sharedId) return path.join(modelsFolder, 'shared');
  if (model.architecture) return path.join(modelsFolder, model.architecture);
  return path.join(modelsFolder, 'other');
}

/**
 * Look a model up across both registries, applying a variant override when
 * one is named. Returns null when the id is unknown.
 *
 * `targetDirOverride` is honoured for auto-tagger models only, matching the
 * previous route behaviour — training models are always filed by architecture.
 */
export function resolveDownload(
  modelId: string,
  opts: { variantId?: string; targetDirOverride?: string } = {},
): ResolvedDownload | null {
  const training = getTrainingDownloadable(modelId);
  if (training) {
    const variant = opts.variantId
      ? training.variants?.find((v) => v.id === opts.variantId)
      : undefined;
    const model = variant
      ? {
          ...training,
          files: variant.files,
          repoId: variant.repoId ?? training.repoId,
        }
      : training;
    return {
      model,
      targetDir: opts.targetDirOverride ?? trainingTargetDir(model),
    };
  }

  const taggerModel = getModel(modelId);
  if (taggerModel) {
    return {
      model: taggerModelToDownloadable(taggerModel),
      // Auto-tagger models go to a per-provider folder in the models folder.
      targetDir: opts.targetDirOverride ?? getModelDir(taggerModel),
    };
  }

  return null;
}

/**
 * The `.model.json` blob written next to a completed training download, so the
 * model scanner can identify it without inferring anything from the folder
 * layout. Null for auto-tagger models, which have no such sidecar.
 *
 * The sidecar writes the file at completion — which may well happen with no
 * browser attached, so it can't stay on the Node side.
 */
export function buildModelSidecar(
  model: DownloadableModel,
): { meta: Omit<ModelSidecar, 'downloadedAt'>; fileName: string } | null {
  if (model.feature !== 'training' || !model.architecture) return null;

  return {
    // `downloadedAt` is stamped by the sidecar when it writes the file. Setting
    // it here would date the model to when the download *started*, which for a
    // 20 GB checkpoint resumed across two sessions is nowhere near the truth.
    meta: {
      name: model.name,
      architecture: model.architecture,
      componentType: model.componentType,
      source: model.repoId,
    },
    fileName: model.files[0]?.name ?? model.id,
  };
}
