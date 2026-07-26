import fs from 'node:fs';
import path from 'node:path';

import { NextRequest, NextResponse } from 'next/server';

import { getImageMimeType, isSupportedImageExtension } from '@/app/constants';
import {
  getLoraOutputRoot,
  getTrainingJobsDir,
} from '@/app/services/training/training-root';

/** True if `target` resolves to a path at or below `root`. */
const isWithin = (root: string, target: string): boolean => {
  const rel = path.relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/** A single safe path segment: no separators/traversal, not empty, not all dots. */
const isSafeJobId = (id: string): boolean =>
  /^[A-Za-z0-9._-]+$/.test(id) && !/^\.+$/.test(id);

/**
 * Resolve a request path to a file plus the root it must stay inside. The
 * leading segment names the scope explicitly rather than the route inferring it
 * from a disk-relative path:
 *
 * - `jobs/<jobId>/<file>` — archived into the run's own job folder by the
 *   sidecar. The fixed `samples` subdir is added here, so it doesn't have to
 *   appear in the URL under a route already called `samples`. Confined to that
 *   one run's folder, not merely to the training root.
 * - `loras/<path>` — still where the trainer wrote it (`sample/<file>`,
 *   `<name>/samples/<file>`), so it resolves against the loras root.
 *
 * `samples-model.ts#sampleUrl` builds these from the stored paths; the stored
 * form is unchanged and still means what `training-sidecar/sample_archive.py`
 * says it does.
 */
const resolveRequest = (
  segments: string[],
): { root: string; target: string } | null => {
  const [scope, ...rest] = segments;

  if (scope === 'jobs') {
    const [jobId, ...file] = rest;
    if (!jobId || !isSafeJobId(jobId) || file.length === 0) return null;
    const root = path.resolve(getTrainingJobsDir(), jobId, 'samples');
    return { root, target: path.resolve(root, ...file) };
  }

  if (scope === 'loras' && rest.length > 0) {
    const root = path.resolve(getLoraOutputRoot());
    return { root, target: path.resolve(root, ...rest) };
  }

  return null;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path: pathSegments } = await params;

    const resolved = resolveRequest(pathSegments);
    if (!resolved) {
      return new NextResponse('Not found', { status: 404 });
    }

    const { root: samplesRoot, target: resolvedPath } = resolved;
    if (!isWithin(samplesRoot, resolvedPath)) {
      return new NextResponse('Access denied', { status: 403 });
    }

    // This route only ever serves sample images — reject anything else
    // before touching disk.
    const ext = path.extname(resolvedPath).toLowerCase();
    if (!isSupportedImageExtension(ext)) {
      return new NextResponse('Not found', { status: 404 });
    }

    if (!fs.existsSync(resolvedPath)) {
      return new NextResponse('Sample not found', { status: 404 });
    }

    const stats = fs.statSync(resolvedPath);
    if (!stats.isFile()) {
      return new NextResponse('Not found', { status: 404 });
    }

    const fileBuffer = fs.readFileSync(resolvedPath);

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': getImageMimeType(ext),
        'Content-Length': stats.size.toString(),
        'Cache-Control': 'public, max-age=31536000, immutable', // Filenames are timestamped/immutable
      },
    });
  } catch (error) {
    console.error('Error serving training sample:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

/**
 * DELETE /api/training/samples/jobs/<jobId> — remove a run's sample images.
 * Fired fire-and-forget when a run leaves Run History. Same `jobs/<jobId>`
 * scoping GET uses, one folder up from the file it serves; anything else is a
 * 400. Idempotent: a nonexistent folder still succeeds.
 *
 * Only `samples/` goes. The rest of `<training>/jobs/<jobId>/` is the sidecar's
 * — generated TOML and run metadata — and isn't this route's to delete.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path: pathSegments } = await params;
    const [scope, jobId] = pathSegments;

    if (pathSegments.length !== 2 || scope !== 'jobs' || !isSafeJobId(jobId)) {
      return new NextResponse('Bad request', { status: 400 });
    }

    const jobsRoot = path.resolve(getTrainingJobsDir());
    const samplesDir = path.resolve(jobsRoot, jobId, 'samples');

    if (!isWithin(jobsRoot, samplesDir)) {
      return new NextResponse('Access denied', { status: 403 });
    }

    // force:true makes a missing folder a no-op, so deletion is idempotent.
    fs.rmSync(samplesDir, { recursive: true, force: true });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Error deleting training samples:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
