/**
 * API Route: /api/model-manager/download
 *
 * POST — Downloads a model from HuggingFace with streaming SSE progress.
 * DELETE — Cleans up partial/downloaded files for a model.
 */

import fs from 'fs';
import { NextRequest } from 'next/server';
import path from 'path';

import { getModel } from '@/app/services/auto-tagger';
import {
  getHfToken,
  getModelsFolder,
} from '@/app/services/config/server-config';
import {
  isDownloadActive,
  markDownloadActive,
  markDownloadInactive,
} from '@/app/services/model-manager/active-downloads';
import { downloadModelFiles } from '@/app/services/model-manager/download-engine';
import { taggerModelToDownloadable } from '@/app/services/model-manager/registries/auto-tagger-models';
import { getTrainingDownloadable } from '@/app/services/model-manager/registries/training-models';
import type { ModelSidecar } from '@/app/services/model-manager/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { modelId, targetDir, variantId } = body;

    if (!modelId) {
      return new Response(JSON.stringify({ error: 'modelId is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Look up the model in both registries
    let downloadable = getTrainingDownloadable(modelId);
    let resolvedTargetDir = targetDir;

    // Apply variant overrides if specified
    const variant = variantId
      ? downloadable?.variants?.find((v) => v.id === variantId)
      : undefined;
    if (variant && downloadable) {
      downloadable = {
        ...downloadable,
        files: variant.files,
        repoId: variant.repoId ?? downloadable.repoId,
      };
    }

    if (!downloadable) {
      // Try auto-tagger models
      const taggerModel = getModel(modelId);
      if (taggerModel) {
        downloadable = taggerModelToDownloadable(taggerModel);
        // Auto-tagger models go to their own directory
        resolvedTargetDir =
          targetDir ??
          path.join(
            process.cwd(),
            '.auto-tagger',
            'models',
            taggerModel.provider,
            taggerModel.id,
          );
      }
    }

    if (!downloadable) {
      return new Response(JSON.stringify({ error: 'Model not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Resolve target directory for training models
    if (!resolvedTargetDir) {
      const modelsFolder = getModelsFolder();
      if (downloadable.sharedId) {
        resolvedTargetDir = path.join(modelsFolder, 'shared');
      } else if (downloadable.architecture) {
        resolvedTargetDir = path.join(modelsFolder, downloadable.architecture);
      } else {
        resolvedTargetDir = path.join(modelsFolder, 'other');
      }
    }

    const activeModelId = downloadable.id;

    // Server-side guard: the UI suppresses colliding actions, but a second
    // tab can still POST. Two generators appending to the same files would
    // interleave writes and corrupt them.
    if (isDownloadActive(activeModelId)) {
      return new Response(
        JSON.stringify({
          error: 'A download for this model is already in progress',
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const downloadId = `dl-${Date.now()}-${modelId}`;
    markDownloadActive(activeModelId);

    // Create a readable stream for SSE
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const progress of downloadModelFiles(
            {
              modelId: downloadable.id,
              downloadId,
              repoId: downloadable.repoId,
              files: downloadable.files,
              targetDir: resolvedTargetDir,
              hfToken: getHfToken(),
            },
            request.signal,
          )) {
            const data = JSON.stringify(progress);
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));

            // Write .model.json sidecar on completion (for training models)
            if (
              progress.status === 'ready' &&
              downloadable.feature === 'training' &&
              downloadable.architecture
            ) {
              const sidecar: ModelSidecar = {
                name: downloadable.name,
                architecture: downloadable.architecture,
                componentType: downloadable.componentType,
                source: downloadable.repoId,
                downloadedAt: new Date().toISOString(),
              };
              const sidecarPath = path.join(
                resolvedTargetDir,
                `${downloadable.files[0]?.name ?? downloadable.id}.model.json`,
              );
              fs.writeFileSync(
                sidecarPath,
                JSON.stringify(sidecar, null, 2),
                'utf8',
              );
            }

            if (progress.status === 'error' || progress.status === 'ready') {
              controller.close();
              return;
            }
          }
        } catch (error) {
          // If the client disconnected (abort), the controller may already
          // be torn down — enqueue/close will throw. Swallow those.
          const isAbort =
            error instanceof Error &&
            (error.name === 'AbortError' || request.signal.aborted);
          if (!isAbort) {
            try {
              const errorData = JSON.stringify({
                downloadId,
                modelId,
                status: 'error',
                error: error instanceof Error ? error.message : 'Unknown error',
                bytesDownloaded: 0,
                totalBytes: 0,
              });
              controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
            } catch {
              // controller already closed
            }
          }
          try {
            controller.close();
          } catch {
            // already closed
          }
        } finally {
          markDownloadInactive(activeModelId);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Download error:', error);
    return new Response(JSON.stringify({ error: 'Failed to start download' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * DELETE — Clean up downloaded/partial files for a model.
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { modelId } = body;

    if (!modelId) {
      return Response.json({ error: 'modelId is required' }, { status: 400 });
    }

    // Find the model to determine its storage location
    let downloadable = getTrainingDownloadable(modelId);
    let targetDir: string | null = null;

    if (downloadable) {
      const modelsFolder = getModelsFolder();
      if (downloadable.sharedId) {
        targetDir = path.join(modelsFolder, 'shared');
      } else if (downloadable.architecture) {
        targetDir = path.join(modelsFolder, downloadable.architecture);
      } else {
        targetDir = path.join(modelsFolder, 'other');
      }
    } else {
      const taggerModel = getModel(modelId);
      if (taggerModel) {
        targetDir = path.join(
          process.cwd(),
          '.auto-tagger',
          'models',
          taggerModel.provider,
          taggerModel.id,
        );
        downloadable = taggerModelToDownloadable(taggerModel);
      }
    }

    if (!downloadable || !targetDir) {
      return Response.json({ error: 'Model not found' }, { status: 404 });
    }

    // Refuse to delete files a live download is writing to — on Windows the
    // unlink would fail against the open handle and leave a half-wiped model.
    if (isDownloadActive(downloadable.id)) {
      return Response.json(
        { error: 'Model is downloading — cancel the download first' },
        { status: 409 },
      );
    }

    // Collect all known file names across the default + every variant.
    // This way deleting "Flux.1 Dev" wipes whichever quantisation the user
    // actually downloaded, not just the default fp16/bf16 layout.
    const allFileNames = new Set<string>();
    for (const f of downloadable.files) allFileNames.add(f.name);
    for (const v of downloadable.variants ?? []) {
      for (const f of v.files) allFileNames.add(f.name);
    }

    let deletedCount = 0;
    for (const fileName of allFileNames) {
      const filePath = path.join(targetDir, fileName);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        deletedCount++;
      }
      // Also clean up the metadata sidecars (model info + resume validation)
      for (const extra of [
        `${filePath}.model.json`,
        `${filePath}.download-meta.json`,
      ]) {
        if (fs.existsSync(extra)) {
          fs.unlinkSync(extra);
        }
      }
    }

    // Clean up the per-model manifest. Other models sharing this directory
    // have their own manifests, so this only removes the one we wrote.
    const manifestPath = path.join(
      targetDir,
      `${downloadable.id}.manifest.json`,
    );
    if (fs.existsSync(manifestPath)) {
      fs.unlinkSync(manifestPath);
    }

    return Response.json({ deleted: deletedCount });
  } catch (error) {
    console.error('Delete error:', error);
    return Response.json(
      { error: 'Failed to delete model files' },
      { status: 500 },
    );
  }
}
