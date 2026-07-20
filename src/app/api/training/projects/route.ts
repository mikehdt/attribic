import { NextResponse } from 'next/server';

import {
  createProject,
  listProjects,
} from '@/app/services/training-projects/fs';
import type { FormState } from '@/app/store/training-config/types';

import { nameErrorResponse } from './name-errors';

export async function GET() {
  try {
    const projects = await listProjects();
    return NextResponse.json({ projects });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      name?: string;
      form?: FormState;
      label?: string | null;
    };

    if (!body.name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (!body.form) {
      return NextResponse.json({ error: 'form is required' }, { status: 400 });
    }

    const result = await createProject(
      body.name,
      body.form,
      body.label ?? null,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const named = nameErrorResponse(error);
    if (named) return named;
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
