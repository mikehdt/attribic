import { NextResponse } from 'next/server';

import { addVersion } from '@/app/services/training-projects/fs';
import type { FormState } from '@/app/store/training-config/types';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = (await request.json()) as {
      form?: FormState;
      label?: string | null;
    };
    if (!body.form) {
      return NextResponse.json({ error: 'form is required' }, { status: 400 });
    }
    const result = await addVersion(id, body.form, body.label ?? null);
    if (!result) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
