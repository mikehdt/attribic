import { NextResponse } from 'next/server';

import { dismissJobRecordsOnDisk } from '@/app/services/training/job-records';
import { connectSidecar } from '@/app/services/training/sidecar-manager';

/**
 * POST /api/training/clear?job_id=… — record that a finished run has been
 * cleared from the activity panel, so refreshing the page doesn't re-surface it.
 *
 * Dismissal only, despite the route name: the run keeps its record on disk and
 * stays in Run History. Deleting a run is `DELETE /api/training/jobs/<id>`,
 * driven solely by an explicit delete in the history view.
 *
 * `job_id` is forwarded so only the dismissed run is affected — omitting it
 * dismisses every terminal run.
 *
 * Sidecar-first, because a running sidecar holds every job in memory and its
 * next persist would rewrite the file from that copy; with no sidecar to tell,
 * the flag is written straight to the record instead (see
 * `dismissJobRecordsOnDisk`, which enforces that condition itself). Only when
 * neither is possible — a sidecar process alive but not answering — does this
 * answer `unreachable`, which the caller retries: the flag is the only thing
 * keeping a cleared card out of the panel after a reload, so a success-shaped
 * no-op would resurrect it.
 */
export async function POST(request: Request) {
  const jobId = new URL(request.url).searchParams.get('job_id');

  // Never boot the sidecar just to dismiss.
  const sidecar = await connectSidecar();
  if (sidecar.status === 'ready') {
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

  const dismissed = await dismissJobRecordsOnDisk(jobId ?? undefined);
  if (dismissed === null) {
    return NextResponse.json({
      status: 'unreachable',
      sidecar_status: sidecar.status,
    });
  }
  return NextResponse.json({
    status: 'dismissed',
    count: dismissed,
    source: 'disk',
  });
}
