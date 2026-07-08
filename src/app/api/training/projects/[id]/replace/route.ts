import { NextResponse } from 'next/server';

import { replaceProject } from '@/app/services/training-projects/fs';
import type { FormState } from '@/app/store/training-config/types';

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/training/projects/{id}/replace — replace a project entirely.
 * Deletes all existing versions and starts fresh at v1 with the given form.
 * Used by the Save As → "replace existing project" flow.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = (await request.json()) as {
      form?: FormState;
      name?: string;
      label?: string | null;
    };
    if (!body.form) {
      return NextResponse.json({ error: 'form is required' }, { status: 400 });
    }
    const result = await replaceProject(id, body.form, {
      name: body.name,
      label: body.label,
    });
    if (!result) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
