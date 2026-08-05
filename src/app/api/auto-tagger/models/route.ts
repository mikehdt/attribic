/**
 * API Route: GET /api/auto-tagger/models
 * Returns list of available models and their installation status
 */

import { NextResponse } from 'next/server';

import {
  getAllModels,
  getAllProviders,
  getModelTotalSize,
} from '@/app/services/auto-tagger';
import { checkModelStatus } from '@/app/services/auto-tagger/model-manager';
import { activeDownloadModelIds } from '@/app/services/model-manager/sidecar-downloads';

export async function GET() {
  try {
    // Models with bytes landing right now, so a second tab (or this one after
    // a refresh) suppresses actions that would collide with the live write.
    const downloading = await activeDownloadModelIds();

    const providers = getAllProviders().map((provider) => ({
      id: provider.id,
      name: provider.name,
      description: provider.description,
      providerType: provider.providerType,
    }));

    const models = getAllModels().map((model) => {
      const diskStatus = checkModelStatus(model);
      return {
        id: model.id,
        name: model.name,
        provider: model.provider,
        description: model.description,
        isDefault: model.isDefault,
        totalSize: getModelTotalSize(model),
        // Field renamed from vramEstimate → memoryEstimate to reflect that
        // llama-cpp models on CPU builds load into RAM, not VRAM. The UI
        // picks the label via `runtime`.
        memoryEstimate: model.vramEstimate,
        runtime: model.runtime,
        supportsVideo: model.supportsVideo,
        videoDefaults: model.videoDefaults,
        status: downloading.has(model.id) ? 'downloading' : diskStatus,
      };
    });

    return NextResponse.json({ providers, models });
  } catch (error) {
    console.error('Failed to get models:', error);
    return NextResponse.json(
      { error: 'Failed to get models' },
      { status: 500 },
    );
  }
}
