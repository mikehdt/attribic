import { NextResponse } from 'next/server';

import { connectSidecar } from '@/app/services/training/sidecar-manager';

/**
 * POST /api/training/cancel?job_id=… — Cancel a training job.
 *
 * `job_id` is forwarded to the sidecar so a specific queued or running job is
 * cancelled. Without it the sidecar falls back to its "focus" job (the running
 * one, else the oldest queued), which is the wrong target once more than one
 * job is in the queue.
 *
 * Never spawns the sidecar: if it isn't running, there's nothing to cancel.
 */
export async function POST(request: Request) {
  const sidecar = await connectSidecar();
  if (sidecar.status !== 'ready') {
    return NextResponse.json(
      { error: 'Sidecar is not running — no active job to cancel' },
      { status: 409 },
    );
  }

  const jobId = new URL(request.url).searchParams.get('job_id');
  const query = jobId ? `?job_id=${encodeURIComponent(jobId)}` : '';

  try {
    const res = await fetch(
      `http://127.0.0.1:${sidecar.port}/jobs/cancel${query}`,
      { method: 'POST' },
    );

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to cancel training: ${error}` },
      { status: 500 },
    );
  }
}
