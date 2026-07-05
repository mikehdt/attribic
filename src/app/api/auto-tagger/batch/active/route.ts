/**
 * API Route: GET /api/auto-tagger/batch/active?project=<folderName>
 *
 * List caption batches the sidecar knows about for a project — running,
 * queued, and terminal-but-uncollected. A client that lost its connection
 * (page refresh, closed tab) calls this on mount to discover batches it
 * should reattach to via /api/auto-tagger/batch/attach.
 */

import { NextRequest, NextResponse } from 'next/server';

import { listCaptionBatches } from '@/app/services/auto-tagger/providers/vlm/client';

export async function GET(request: NextRequest) {
  const project = request.nextUrl.searchParams.get('project') ?? undefined;

  const batches = await listCaptionBatches(project);
  return NextResponse.json({
    batches: batches.map((b) => ({
      batchId: b.batch_id,
      status: b.status,
      current: b.current,
      total: b.total,
      project: b.project,
      modelPath: b.model_path,
      queuePosition: b.queue_position,
      resultCount: b.result_count,
    })),
  });
}
