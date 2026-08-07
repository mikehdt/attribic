/**
 * API Route: GET /api/model-manager/status
 *
 * Returns the installation status of all downloadable models.
 * Checks disk for file existence.
 */

import path from 'path';

import { getAllModels } from '@/app/services/auto-tagger';
import { checkModelStatus } from '@/app/services/auto-tagger/model-manager';
import { getModelsFolder } from '@/app/services/config/server-config';
import { ALL_TRAINING_MODELS } from '@/app/services/model-manager/registries/training-models';
import { activeDownloadModelIds } from '@/app/services/model-manager/sidecar-downloads';
import {
  checkModelFiles,
  getInstalledFileNames,
} from '@/app/services/model-manager/status-checker';

export async function GET() {
  try {
    const modelsFolder = getModelsFolder();
    const statuses: Record<
      string,
      { status: string; localPath: string | null; resolvedPath?: string | null }
    > = {};

    // A download in flight overrides the disk check so nothing offers Delete or
    // Resume against bytes that are landing right now. The sidecar owns
    // downloads, so this covers every tab and survives a Node restart — the
    // old in-process Set only ever knew about this process's own transfers.
    const downloading = await activeDownloadModelIds();

    for (const model of getAllModels()) {
      const diskStatus = checkModelStatus(model);
      statuses[model.id] = {
        status: downloading.has(model.id) ? 'downloading' : diskStatus,
        localPath: null, // auto-tagger paths are computed internally
      };
    }

    // Check training models
    for (const model of ALL_TRAINING_MODELS) {
      let modelDir: string;
      if (model.sharedId) {
        modelDir = path.join(modelsFolder, 'shared');
      } else if (model.architecture) {
        modelDir = path.join(modelsFolder, model.architecture);
      } else {
        modelDir = path.join(modelsFolder, 'other');
      }

      const diskStatus = checkModelFiles(modelDir, model.id, model.files);
      const status = downloading.has(model.id) ? 'downloading' : diskStatus;

      // Path the training form should use for a ready install. The manifest
      // knows which variant's files actually exist, so it wins over the
      // registry's default file list (an fp8 install must not resolve to
      // the fp16 filename). Single file → the file; bundle → the directory.
      let resolvedPath: string | null = null;
      if (status === 'ready') {
        const fileNames =
          getInstalledFileNames(modelDir, model.id) ??
          model.files.map((f) => f.name);
        resolvedPath =
          fileNames.length === 1 ? path.join(modelDir, fileNames[0]) : modelDir;
      }

      statuses[model.id] = {
        status,
        localPath: status === 'ready' ? modelDir : null,
        resolvedPath,
      };
    }

    return Response.json({ statuses, modelsFolder });
  } catch (error) {
    console.error('Status check error:', error);
    return Response.json(
      { error: 'Failed to check model status' },
      { status: 500 },
    );
  }
}
