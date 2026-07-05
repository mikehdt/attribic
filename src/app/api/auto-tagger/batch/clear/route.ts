/**
 * API Route: POST /api/auto-tagger/batch/clear
 *
 * Drop a terminal caption batch (and its stored results) from the sidecar
 * once the client has flushed the results. Keeps the sidecar's batch list
 * from accumulating forever and stops /batch/active re-surfacing batches
 * the client already collected.
 */

import { NextRequest, NextResponse } from 'next/server';

import { clearCaptionBatch } from '@/app/services/auto-tagger/providers/vlm/client';

export async function POST(request: NextRequest) {
  try {
    const { batchId } = await request.json();
    if (!batchId || typeof batchId !== 'string') {
      return NextResponse.json(
        { error: 'batchId is required' },
        { status: 400 },
      );
    }

    await clearCaptionBatch(batchId);
    return NextResponse.json({ status: 'cleared' });
  } catch {
    return NextResponse.json(
      { error: 'Failed to clear batch' },
      { status: 500 },
    );
  }
}
