import fs from 'node:fs';
import path from 'node:path';

import { NextRequest, NextResponse } from 'next/server';

import { getImageMimeType } from '@/app/constants';
import { getProjectsFolder } from '@/app/services/config/server-config';

/** True if `target` resolves to a path at or below `root`. */
const isWithin = (root: string, target: string): boolean => {
  const rel = path.relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    // Await params before using its properties
    const { path: pathSegments } = await params;

    const projectName = request.nextUrl.searchParams.get('projectName');
    if (!projectName) {
      return new NextResponse('Project name required', { status: 400 });
    }

    // Confine everything to the configured projects root. Both `projectName`
    // (query) and the asset path segments (URL) are untrusted, so resolve the
    // final path and verify it stays within the projects root *before* touching
    // disk. Without this, a `..`-laden segment or an absolute `projectName`
    // would let any file on the machine be read.
    const projectsRoot = path.resolve(getProjectsFolder() || 'public/assets');
    const resolvedPath = path.resolve(
      projectsRoot,
      projectName,
      ...pathSegments,
    );

    if (!isWithin(projectsRoot, resolvedPath)) {
      return new NextResponse('Access denied', { status: 403 });
    }

    if (!fs.existsSync(resolvedPath)) {
      return new NextResponse('Image not found', { status: 404 });
    }

    const stats = fs.statSync(resolvedPath);
    if (!stats.isFile()) {
      return new NextResponse('Not found', { status: 404 });
    }

    // Determine content type based on file extension
    const ext = path.extname(resolvedPath).toLowerCase();
    const contentType = getImageMimeType(ext);

    // Read and return the file
    const fileBuffer = fs.readFileSync(resolvedPath);

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': stats.size.toString(),
        'Cache-Control': 'public, max-age=31536000, immutable', // Cache for 1 year
      },
    });
  } catch (error) {
    console.error('Error serving image:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
