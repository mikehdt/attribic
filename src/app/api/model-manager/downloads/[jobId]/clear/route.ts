/**
 * API Route: POST /api/model-manager/downloads/[jobId]/clear
 *
 * Drop a terminal download's record from the sidecar so its card leaves the
 * activity panel for good — without this, the next resync would bring it
 * straight back. Files on disk are untouched; deleting those is
 * DELETE /api/model-manager/download.
 */

import { clearSidecarDownload } from '@/app/services/model-manager/sidecar-downloads';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  // A sidecar that isn't running has no record to clear, so the client's
  // card is already gone as far as the server is concerned — not an error.
  await clearSidecarDownload(jobId);
  return Response.json({ status: 'cleared' });
}
