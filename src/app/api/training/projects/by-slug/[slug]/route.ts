import { NextResponse } from 'next/server';

import {
  findMetaBySlug,
  loadProject,
} from '@/app/services/training-projects/fs';

type Params = { params: Promise<{ slug: string }> };

/**
 * GET /api/training/projects/by-slug/{slug}?version=N
 *
 * Resolve a URL slug to a project and return the same `{ meta, version }`
 * shape as the by-id route. This exists so restoring `/training/my-project/v2`
 * on a cold load is a single request — the client has a slug, not an id, and
 * fetching the whole project list just to map one would read every version
 * file on disk.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const { slug } = await params;
    const meta = await findMetaBySlug(decodeURIComponent(slug));
    if (!meta) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    const versionParam = new URL(request.url).searchParams.get('version');
    const parsed = versionParam
      ? Number.parseInt(versionParam, 10)
      : Number.NaN;

    // A URL can outlive the version it names — deleting v5 shouldn't turn a
    // bookmark into a dead end, so fall back to the project's latest. The
    // client canonicalises the URL from whatever comes back.
    const requested = Number.isFinite(parsed) ? parsed : undefined;
    const result =
      (await loadProject(meta.id, requested)) ??
      (requested === undefined ? null : await loadProject(meta.id));

    if (!result) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
