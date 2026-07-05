import { NextResponse } from 'next/server';

import {
  connectSidecar,
  getSidecarActiveJob,
  restartSidecar,
} from '@/app/services/training/sidecar-manager';

/**
 * POST /api/training/sidecar/restart — Kill and re-spawn the Python sidecar so
 * it picks up code changes. Since Node keeps the sidecar alive across HMR, this
 * is the only way to reload sidecar edits without bouncing the whole app.
 *
 * Guarded: refuses (409) while a training job is active unless `{ force: true }`
 * is sent — restarting mid-run kills the training. The body is optional.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const force = body?.force === true;

  // Only guard when the sidecar is actually reachable; if it's down, a
  // "restart" is just a fresh start with nothing to protect.
  const sidecar = await connectSidecar();
  if (sidecar.status === 'ready' && !force) {
    const activeJob = await getSidecarActiveJob();
    if (activeJob) {
      return NextResponse.json(
        {
          error: 'A job is currently running on the sidecar.',
          activeJob,
        },
        { status: 409 },
      );
    }
  }

  const result = await restartSidecar();
  return NextResponse.json(result, {
    status: result.status === 'ready' ? 200 : 500,
  });
}
