import { NextResponse } from 'next/server';

import { getStartSidecarOnLaunch } from '@/app/services/config/server-config';
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
 *
 * The app-launch warm-up passes `trigger: 'app-launch'` so the user's
 * start-on-launch setting can veto it — checked here rather than in the client
 * because config.json lives server-side. When vetoed we still `connectSidecar`
 * so an already-running sidecar (started manually, or surviving a Node
 * restart) is reconnected and reported accurately, just never spawned.
 * Explicit starts from the global menu send no trigger and always spawn.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));

  if (body?.trigger === 'app-launch' && !getStartSidecarOnLaunch()) {
    await connectSidecar();
    return NextResponse.json({ ...getSidecarStatus(), skipped: true });
  }

  const result = await ensureSidecar();
  const httpStatus = result.status === 'ready' ? 200 : 503;
  return NextResponse.json(result, { status: httpStatus });
}
