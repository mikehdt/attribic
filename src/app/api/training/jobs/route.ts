import { NextResponse } from 'next/server';

import { connectSidecar } from '@/app/services/training/sidecar-manager';

/**
 * GET /api/training/jobs — every training job the sidecar is tracking.
 *
 * The twin of `/api/training/status`, which returns only the sidecar's single
 * "focus" job. The client reconciles against this list after its progress
 * WebSocket reconnects, where any of the queued / running / just-finished jobs
 * may have moved on while the stream was down.
 *
 * Read-only, like the status route: connects to a running sidecar (or an
 * orphan) but never spawns one, and answers an empty list rather than an error
 * when there's nothing to reach.
 */
export async function GET() {
  const sidecar = await connectSidecar();
  if (sidecar.status !== 'ready') {
    return NextResponse.json(
      { jobs: [], sidecar_status: sidecar.status },
      { status: 200 },
    );
  }

  try {
    const res = await fetch(`http://127.0.0.1:${sidecar.port}/jobs`);
    if (!res.ok) {
      // Most likely an older sidecar that predates this route — answer the
      // documented shape so the caller reads it as "nothing to reconcile"
      // rather than having to recognise a sidecar error body.
      return NextResponse.json(
        { jobs: [], error: `Sidecar returned ${res.status}` },
        { status: 200 },
      );
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { jobs: [], error: `Failed to reach sidecar: ${error}` },
      { status: 200 },
    );
  }
}
