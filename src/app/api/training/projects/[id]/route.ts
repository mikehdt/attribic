import { NextResponse } from 'next/server';

import {
  deleteProject,
  loadProject,
  renameProject,
  setProjectColor,
  setProjectFeatured,
} from '@/app/services/training-projects/fs';
import { isProjectColor } from '@/app/shared/project-colors';

import { nameErrorResponse } from '../name-errors';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const versionParam = url.searchParams.get('version');
    const version = versionParam
      ? Number.parseInt(versionParam, 10)
      : undefined;

    const result = await loadProject(
      id,
      Number.isFinite(version!) ? version : undefined,
    );
    if (!result) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = (await request.json()) as {
      name?: string;
      color?: unknown;
      featured?: unknown;
    };
    const hasName = Boolean(body.name?.trim());
    // `color: null` clears the colour; absent leaves it untouched.
    const hasColor = 'color' in body;
    const hasFeatured = 'featured' in body;

    if (!hasName && !hasColor && !hasFeatured) {
      return NextResponse.json(
        { error: 'name, color or featured is required' },
        { status: 400 },
      );
    }
    if (hasColor && body.color !== null && !isProjectColor(body.color)) {
      return NextResponse.json({ error: 'invalid color' }, { status: 400 });
    }
    if (hasFeatured && typeof body.featured !== 'boolean') {
      return NextResponse.json(
        { error: 'featured must be a boolean' },
        { status: 400 },
      );
    }

    let meta = null;
    if (hasName) {
      meta = await renameProject(id, body.name!);
      if (!meta) {
        return NextResponse.json({ error: 'not found' }, { status: 404 });
      }
    }
    if (hasColor) {
      meta = await setProjectColor(
        id,
        isProjectColor(body.color) ? body.color : null,
      );
      if (!meta) {
        return NextResponse.json({ error: 'not found' }, { status: 404 });
      }
    }
    if (hasFeatured) {
      meta = await setProjectFeatured(id, body.featured === true);
      if (!meta) {
        return NextResponse.json({ error: 'not found' }, { status: 404 });
      }
    }
    return NextResponse.json({ meta });
  } catch (error) {
    const named = nameErrorResponse(error);
    if (named) return named;
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ok = await deleteProject(id);
    if (!ok) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
