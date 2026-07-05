import { NextResponse } from 'next/server';

import { connectSidecar } from '@/app/services/training/sidecar-manager';

/**
 * POST /api/training/cancel — Cancel the active training job.
 * Never spawns the sidecar: if it isn't running, there's nothing to cancel.
 */
export async function POST() {
  const sidecar = await connectSidecar();
  if (sidecar.status !== 'ready') {
    return NextResponse.json(
      { error: 'Sidecar is not running — no active job to cancel' },
      { status: 409 },
    );
  }

  try {
    const res = await fetch(`http://127.0.0.1:${sidecar.port}/jobs/cancel`, {
      method: 'POST',
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to cancel training: ${error}` },
      { status: 500 },
    );
  }
}
