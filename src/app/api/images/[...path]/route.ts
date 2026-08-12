import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { NextRequest, NextResponse } from 'next/server';

import { getImageMimeType } from '@/app/constants';
import { getProjectsFolderOrDefault } from '@/app/services/config/server-config';
import { sharp } from '@/app/utils/sharp';

/** True if `target` resolves to a path at or below `root`. */
const isWithin = (root: string, target: string): boolean => {
  const rel = path.relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

// Formats sharp can downscale; videos and anything else pass through untouched
const RESIZABLE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const MAX_DIMENSION = 4096;

// Lives under .next/cache so a stale-route/.next wipe clears it too — entries
// are pure derivatives and regenerate on demand
const PREVIEW_CACHE_DIR = path.join(
  process.cwd(),
  '.next',
  'cache',
  'image-previews',
);

const parseDimension = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.min(parsed, MAX_DIMENSION);
};

/**
 * Downscale to fit within maxWidth/maxHeight (aspect preserved, never
 * enlarged), reading through a disk cache keyed by file identity + caps.
 * Returns null when the original already fits — the caller serves it as-is,
 * avoiding a same-size re-encode.
 */
const getResizedImage = async (
  filePath: string,
  stats: fs.Stats,
  ext: string,
  maxWidth: number | undefined,
  maxHeight: number | undefined,
): Promise<Buffer | null> => {
  const cacheKey = crypto
    .createHash('sha1')
    .update(
      `${filePath}|${stats.mtimeMs}|${stats.size}|${maxWidth ?? ''}|${maxHeight ?? ''}`,
    )
    .digest('hex');
  const cachePath = path.join(PREVIEW_CACHE_DIR, `${cacheKey}${ext}`);

  try {
    return await fs.promises.readFile(cachePath);
  } catch {
    // Cache miss — resize below
  }

  // animated: keeps multi-frame webp animated through the resize; rotate()
  // bakes in EXIF orientation, which sharp otherwise strips with the metadata
  const image = sharp(filePath, { animated: ext === '.webp' }).rotate();
  const metadata = await image.metadata();

  // Compare against display dimensions: EXIF orientations 5-8 swap the axes,
  // and animated images report the all-frames-stacked height
  const isTransposed = (metadata.orientation ?? 1) >= 5;
  const frameHeight = metadata.pageHeight ?? metadata.height;
  const nativeWidth = isTransposed ? frameHeight : metadata.width;
  const nativeHeight = isTransposed ? metadata.width : frameHeight;

  if (!nativeWidth || !nativeHeight) return null;
  if (
    (maxWidth === undefined || nativeWidth <= maxWidth) &&
    (maxHeight === undefined || nativeHeight <= maxHeight)
  ) {
    return null;
  }

  const resized = await image
    .resize({
      width: maxWidth,
      height: maxHeight,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .toBuffer();

  // Write-through cache; temp file + rename so a concurrent request can never
  // read a partially written entry. A failed write still serves the resize.
  try {
    await fs.promises.mkdir(PREVIEW_CACHE_DIR, { recursive: true });
    const tempPath = `${cachePath}.${crypto.randomUUID()}.tmp`;
    await fs.promises.writeFile(tempPath, resized);
    await fs.promises.rename(tempPath, cachePath);
  } catch (error) {
    console.warn('Failed to cache resized image:', error);
  }

  return resized;
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
    const projectsRoot = path.resolve(getProjectsFolderOrDefault());
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

    // Optional preview caps: serve a downscaled variant instead of the
    // original so viewers don't decode multi-thousand-px files for a letterbox
    const maxWidth = parseDimension(request.nextUrl.searchParams.get('w'));
    const maxHeight = parseDimension(request.nextUrl.searchParams.get('h'));

    if ((maxWidth || maxHeight) && RESIZABLE_EXTENSIONS.has(ext)) {
      const resized = await getResizedImage(
        resolvedPath,
        stats,
        ext,
        maxWidth,
        maxHeight,
      );
      if (resized) {
        return new NextResponse(new Uint8Array(resized), {
          headers: {
            'Content-Type': contentType,
            'Content-Length': resized.byteLength.toString(),
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        });
      }
    }

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
