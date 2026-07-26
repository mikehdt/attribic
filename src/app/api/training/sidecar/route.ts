import { NextResponse } from 'next/server';

import {
  connectSidecar,
  ensureSidecar,
  getSidecarStatus,
} from '@/app/services/training/sidecar-manager';

/**
 * GET /api/training/sidecar — Check sidecar status without starting it.
 *
 * The manager's status is per-Node-process module state, but the sidecar is
 * spawned detached precisely so it outlives Node. So a fresh Node process (dev
 * restart, or the first request after a crash) reads 'stopped' while a
 * perfectly healthy sidecar is still running from before — and the menu shows
 * "Stopped" next to a working sidecar.
 *
 * `connectSidecar` resolves that: it health-checks, reclaims an orphan via the
 * PID file, and never spawns. It also re-checks a sidecar we believe is ready,
 * so one that died out from under us stops reading as "Running".
 *
 * Skipped mid-spawn — 'starting' is a state only the spawn path can resolve,
 * and probing underneath it would race with the process writing its PID file.
 */
export async function GET() {
  if (getSidecarStatus().status !== 'starting') {
    await connectSidecar();
  }
  return NextResponse.json(getSidecarStatus());
}

/**
 * POST /api/training/sidecar — Ensure the sidecar is running (start if needed).
 */
export async function POST() {
  const result = await ensureSidecar();
  const httpStatus = result.status === 'ready' ? 200 : 503;
  return NextResponse.json(result, { status: httpStatus });
}
