/**
 * API Route: /api/model-manager/download
 *
 * POST — Resolve a model and hand the download to the Python sidecar.
 * DELETE — Clean up partial/downloaded files for a model.
 *
 * The bytes no longer move through this route. It used to stream them itself
 * and pipe progress back as SSE, which tied the transfer's lifetime to the
 * browser connection: a refresh aborted `request.signal` and killed the
 * download mid-file. The sidecar outlives both the tab and this process, so
 * this route's job is now resolution and hand-off. Progress reaches the client
 * over the sidecar's /ws/downloads channel.
 */

import fs from 'fs';
import { NextRequest } from 'next/server';
import path from 'path';

import {
  buildModelSidecar,
  resolveDownload,
} from '@/app/services/model-manager/resolve-download';
import {
  activeDownloadModelIds,
  startSidecarDownload,
} from '@/app/services/model-manager/sidecar-downloads';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { modelId, targetDir, variantId } = body;

    if (!modelId) {
      return Response.json({ error: 'modelId is required' }, { status: 400 });
    }

    const resolved = resolveDownload(modelId, {
      variantId,
      targetDirOverride: targetDir,
    });
    if (!resolved) {
      return Response.json({ error: 'Model not found' }, { status: 404 });
    }

    const { model } = resolved;
    const sidecarMeta = buildModelSidecar(model);
    // Variant rides along so a retry of, say, the fp8 build doesn't silently
    // come back as fp16.
    const suffix = variantId ? `-${variantId}` : '';
    const jobId = `dl-${Date.now()}-${model.id}${suffix}`;

    const result = await startSidecarDownload({
      jobId,
      modelId: model.id,
      modelName: model.name,
      repoId: model.repoId,
      files: model.files,
      targetDir: resolved.targetDir,
      sidecarMeta: sidecarMeta?.meta,
      sidecarFileName: sidecarMeta?.fileName,
    });

    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }

    return Response.json({
      jobId: result.jobId,
      modelId: model.id,
      modelName: model.name,
      targetDir: resolved.targetDir,
    });
  } catch (error) {
    console.error('Download error:', error);
    return Response.json(
      { error: 'Failed to start download' },
      { status: 500 },
    );
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

    const resolved = resolveDownload(modelId);
    if (!resolved) {
      return Response.json({ error: 'Model not found' }, { status: 404 });
    }

    const { model, targetDir } = resolved;

    // Refuse to delete files a live download is writing to — on Windows the
    // unlink would fail against the open handle and leave a half-wiped model.
    const active = await activeDownloadModelIds();
    if (active.has(model.id)) {
      return Response.json(
        { error: 'Model is downloading — cancel the download first' },
        { status: 409 },
      );
    }

    // Collect all known file names across the default + every variant.
    // This way deleting "Flux.1 Dev" wipes whichever quantisation the user
    // actually downloaded, not just the default fp16/bf16 layout.
    const allFileNames = new Set<string>();
    for (const f of model.files) allFileNames.add(f.name);
    for (const v of model.variants ?? []) {
      for (const f of v.files) allFileNames.add(f.name);
    }

    // Reported back so the client can drop model defaults (and form fields)
    // that pointed at files which no longer exist — otherwise a deleted model
    // keeps reading as "ready" until the next status scan disagrees.
    const deletedPaths: string[] = [];
    for (const fileName of allFileNames) {
      const filePath = path.join(targetDir, fileName);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        deletedPaths.push(filePath);
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
    const manifestPath = path.join(targetDir, `${model.id}.manifest.json`);
    if (fs.existsSync(manifestPath)) {
      fs.unlinkSync(manifestPath);
    }

    return Response.json({
      deleted: deletedPaths.length,
      deletedPaths,
      targetDir,
    });
  } catch (error) {
    console.error('Delete error:', error);
    return Response.json(
      { error: 'Failed to delete model files' },
      { status: 500 },
    );
  }
}
