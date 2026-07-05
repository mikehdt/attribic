import { NextResponse } from 'next/server';

import { connectSidecar } from '@/app/services/training/sidecar-manager';

/**
 * GET /api/training/status — Get current training job status.
 *
 * Read-only: connects to a running sidecar (or reconnects to an orphan)
 * but never spawns one. Polling a status endpoint shouldn't boot a Python
 * server — starting a job does that.
 */
export async function GET() {
  const sidecar = await connectSidecar();
  if (sidecar.status !== 'ready') {
    return NextResponse.json(
      { active: false, sidecar_status: sidecar.status },
      { status: 200 },
    );
  }

  try {
    const res = await fetch(`http://127.0.0.1:${sidecar.port}/jobs/status`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { active: false, error: `Failed to reach sidecar: ${error}` },
      { status: 200 },
    );
  }
}
