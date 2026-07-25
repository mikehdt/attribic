import fs from 'node:fs';
import path from 'node:path';

import { NextRequest, NextResponse } from 'next/server';

import { getImageMimeType, isSupportedImageExtension } from '@/app/constants';
import { getLoraOutputRoot } from '@/app/services/training/training-root';

/** True if `target` resolves to a path at or below `root`. */
const isWithin = (root: string, target: string): boolean => {
  const rel = path.relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/** A single safe path segment: no separators/traversal, not empty, not all dots. */
const isSafeJobId = (id: string): boolean =>
  /^[A-Za-z0-9._-]+$/.test(id) && !/^\.+$/.test(id);

/** Resolve the loras output root the same way the GET/archive routes do. */
const resolveSamplesRoot = (): string => path.resolve(getLoraOutputRoot());

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path: pathSegments } = await params;

    // Confine everything to the loras output root — the same resolver the
    // training request builder uses, so this always matches where samples
    // actually land.
    const samplesRoot = resolveSamplesRoot();
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
 * DELETE /api/training/samples/<jobId> — recursively remove a run's archive
 * folder (`<root>/.run-samples/<jobId>`). Fired fire-and-forget when a run
 * leaves Run History. Exactly one path segment (the jobId); anything else is a
 * 400. Idempotent: a nonexistent folder still succeeds.
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

    const samplesRoot = resolveSamplesRoot();
    const archiveDir = path.resolve(
      samplesRoot,
      '.run-samples',
      pathSegments[0],
    );

    if (!isWithin(samplesRoot, archiveDir)) {
      return new NextResponse('Access denied', { status: 403 });
    }

    // force:true makes a missing folder a no-op, so deletion is idempotent.
    fs.rmSync(archiveDir, { recursive: true, force: true });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Error deleting training samples:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
