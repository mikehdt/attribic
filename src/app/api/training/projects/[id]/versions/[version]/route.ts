import { NextResponse } from 'next/server';

import {
  deleteVersion,
  overwriteVersion,
  setVersionLabel,
} from '@/app/services/training-projects/fs';
import type { FormState } from '@/app/store/training-config/types';

type Params = { params: Promise<{ id: string; version: string }> };

function parseVersion(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function PUT(request: Request, { params }: Params) {
  try {
    const { id, version: versionRaw } = await params;
    const version = parseVersion(versionRaw);
    if (version === null) {
      return NextResponse.json({ error: 'invalid version' }, { status: 400 });
    }

    const body = (await request.json()) as {
      form?: FormState;
      label?: string | null;
    };
    if (!body.form) {
      return NextResponse.json({ error: 'form is required' }, { status: 400 });
    }
    const result = await overwriteVersion(id, version, body.form, body.label);
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
    const { id, version: versionRaw } = await params;
    const version = parseVersion(versionRaw);
    if (version === null) {
      return NextResponse.json({ error: 'invalid version' }, { status: 400 });
    }

    const body = (await request.json()) as { label?: string | null };
    const result = await setVersionLabel(id, version, body.label ?? null);
    if (!result) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    return NextResponse.json({ version: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id, version: versionRaw } = await params;
    const version = parseVersion(versionRaw);
    if (version === null) {
      return NextResponse.json({ error: 'invalid version' }, { status: 400 });
    }

    const meta = await deleteVersion(id, version);
    if (!meta) {
      return NextResponse.json(
        { error: 'cannot delete — last remaining version or not found' },
        { status: 400 },
      );
    }
    return NextResponse.json({ meta });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
