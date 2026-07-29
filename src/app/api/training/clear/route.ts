import { NextResponse } from 'next/server';

import { connectSidecar } from '@/app/services/training/sidecar-manager';

/**
 * POST /api/training/clear?job_id=… — Tell the sidecar a finished run has been
 * cleared from the activity panel, so refreshing the page doesn't re-surface it.
 *
 * Dismissal only, despite the route name: the run keeps its record on disk and
 * stays in Run History. Deleting a run is `DELETE /api/training/jobs/<id>`,
 * driven solely by an explicit delete in the history view.
 *
 * `job_id` is forwarded so only the dismissed run is affected — omitting it
 * dismisses every terminal job the sidecar is holding.
 */
export async function POST(request: Request) {
  // If the sidecar isn't running there's nothing to clear — treat as a
  // no-op rather than booting it just to clear nothing.
  const sidecar = await connectSidecar();
  if (sidecar.status !== 'ready') {
    return NextResponse.json({ status: 'noop' });
  }

  const jobId = new URL(request.url).searchParams.get('job_id');
  const query = jobId ? `?job_id=${encodeURIComponent(jobId)}` : '';

  try {
    const res = await fetch(
      `http://127.0.0.1:${sidecar.port}/jobs/clear${query}`,
      { method: 'POST' },
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to clear training job: ${error}` },
      { status: 500 },
    );
  }
}
