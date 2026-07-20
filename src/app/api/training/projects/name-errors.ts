import { NextResponse } from 'next/server';

import {
  SlugConflictError,
  UnsluggableNameError,
} from '@/app/services/training-projects/fs';

/**
 * Map name-validation failures to 4xx.
 *
 * These are the user's to fix rather than server faults, so the Save As form
 * can flag the name field instead of reporting a generic save failure.
 * Returns null for anything else, leaving the caller's 500 path in charge.
 */
export function nameErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof SlugConflictError) {
    return NextResponse.json(
      { error: error.message, slug: error.slug },
      { status: 409 },
    );
  }
  if (error instanceof UnsluggableNameError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return null;
}
