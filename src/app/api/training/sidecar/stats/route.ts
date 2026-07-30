import { NextResponse } from 'next/server';

import { getSidecarSystemStats } from '@/app/services/training/sidecar-manager';

/**
 * GET /api/training/sidecar/stats — host CPU / memory / GPU load, proxied from
 * the sidecar (which owns psutil and nvidia-smi).
 *
 * 503 when the sidecar isn't reachable, so a stopped sidecar reads as "no
 * stats" rather than an error — this backs a poll, and it must never start one.
 */
export async function GET() {
  const stats = await getSidecarSystemStats();
  if (stats === null) {
    return NextResponse.json({ error: 'Sidecar unavailable' }, { status: 503 });
  }
  return NextResponse.json(stats);
}
