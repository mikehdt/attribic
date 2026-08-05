/**
 * API Route: GET /api/model-manager/downloads
 *
 * Every download the sidecar is tracking — queued, running and terminal. This
 * is what the client reads on mount and after a dropped WebSocket to rebuild
 * its download cards, the same way training runs resync from /api/training/jobs.
 *
 * `sidecarAvailable: false` means the sidecar wasn't there to ask — distinct
 * from an empty list, which means it answered and has nothing. The client needs
 * both: the first says its in-flight cards have stopped moving, the second says
 * they finished.
 */

import { listSidecarDownloads } from '@/app/services/model-manager/sidecar-downloads';

export async function GET() {
  const { available, downloads } = await listSidecarDownloads();
  return Response.json({ sidecarAvailable: available, downloads });
}
