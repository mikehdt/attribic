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
import { isDownloadActive } from '@/app/services/model-manager/active-downloads';
import { ALL_TRAINING_MODELS } from '@/app/services/model-manager/registries/training-models';
import { checkModelFiles } from '@/app/services/model-manager/status-checker';

export async function GET() {
  try {
    const modelsFolder = getModelsFolder();
    const statuses: Record<
      string,
      { status: string; localPath: string | null }
    > = {};

    // Check auto-tagger models. An active download in this process (e.g.
    // started from another browser tab) overrides the disk check so
    // siblings don't see partial bytes and offer Delete/Resume actions.
    for (const model of getAllModels()) {
      const diskStatus = checkModelStatus(model);
      statuses[model.id] = {
        status: isDownloadActive(model.id) ? 'downloading' : diskStatus,
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
      const status = isDownloadActive(model.id) ? 'downloading' : diskStatus;
      statuses[model.id] = {
        status,
        localPath: status === 'ready' ? modelDir : null,
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
