/**
 * API Route: POST /api/model-manager/downloads/[jobId]/cancel
 *
 * Stop a queued or running download. Partial files stay on disk so a later
 * Retry resumes from where it left off rather than starting over.
 *
 * Never spawns the sidecar — if it isn't running, there's nothing to cancel.
 */

import { cancelSidecarDownload } from '@/app/services/model-manager/sidecar-downloads';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const result = await cancelSidecarDownload(jobId);

  if (!result.ok) {
    return Response.json(
      { error: result.error ?? 'Failed to cancel download' },
      { status: result.status },
    );
  }
  return Response.json({ status: 'cancelling' });
}
