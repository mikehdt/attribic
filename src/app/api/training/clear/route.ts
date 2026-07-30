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
 *
 * Answers `{status:'unreachable'}` when there's no sidecar to tell, rather than
 * a success-shaped no-op: the dismissed flag is the only thing keeping a cleared
 * card out of the panel after a reload, so the caller has to be able to see that
 * nothing was recorded and retry.
 */
export async function POST(request: Request) {
  // Never boot the sidecar just to dismiss — but say so plainly, because
  // "nothing to clear" and "couldn't clear" are not the same outcome.
  const sidecar = await connectSidecar();
  if (sidecar.status !== 'ready') {
    return NextResponse.json({
      status: 'unreachable',
      sidecar_status: sidecar.status,
    });
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
