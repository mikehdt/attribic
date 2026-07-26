import fs from 'node:fs';
import path from 'node:path';

import { NextRequest, NextResponse } from 'next/server';

import { getImageMimeType, isSupportedImageExtension } from '@/app/constants';
import {
  getLoraOutputRoot,
  getTrainingJobsDir,
  getTrainingRoot,
} from '@/app/services/training/training-root';

/** True if `target` resolves to a path at or below `root`. */
const isWithin = (root: string, target: string): boolean => {
  const rel = path.relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/** A single safe path segment: no separators/traversal, not empty, not all dots. */
const isSafeJobId = (id: string): boolean =>
  /^[A-Za-z0-9._-]+$/.test(id) && !/^\.+$/.test(id);

/** Resolve the loras output root the same way the archive route does. */
const resolveSamplesRoot = (): string => path.resolve(getLoraOutputRoot());

/**
 * Sample paths come in two flavours, and the leading segment says which root
 * they belong to:
 *
 * - `jobs/<jobId>/samples/<file>` — archived into the run's own job folder by
 *   the sidecar, so it resolves against the **training root**.
 * - anything else (`sample/<file>`, `<name>/samples/<file>`) — still where the
 *   trainer wrote it, so it resolves against the **loras root**.
 *
 * The two roots are siblings under the projects folder, so neither contains the
 * other and a path can't be read against the wrong one. The cost is that `jobs`
 * is a reserved top-level name at the loras root; nothing writes one there.
 * Mirrored in `training-sidecar/sample_archive.py` — keep the two in step.
 */
const resolveSampleRootFor = (segments: string[]): string =>
  segments[0] === 'jobs'
    ? path.resolve(getTrainingRoot())
    : resolveSamplesRoot();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path: pathSegments } = await params;

    // Confine everything to whichever root this path belongs to — both are
    // resolvers the training system itself uses, so this always matches where
    // samples actually land.
    const samplesRoot = resolveSampleRootFor(pathSegments);
    const resolvedPath = path.resolve(samplesRoot, ...pathSegments);

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
 * DELETE /api/training/samples/<jobId> — remove a run's sample images. Fired
 * fire-and-forget when a run leaves Run History. Exactly one path segment (the
 * jobId); anything else is a 400. Idempotent: a nonexistent folder still
 * succeeds.
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

    if (pathSegments.length !== 1 || !isSafeJobId(pathSegments[0])) {
      return new NextResponse('Bad request', { status: 400 });
    }

    const jobsRoot = path.resolve(getTrainingJobsDir());
    const samplesDir = path.resolve(jobsRoot, pathSegments[0], 'samples');

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
