/**
 * API Route: POST /api/auto-tagger/batch/cancel
 *
 * Explicitly cancel a caption batch on the sidecar. Since a client abort no
 * longer cancels the batch (batches survive tab closes for reattach), this
 * is the only way a user cancel reaches the sidecar.
 */

import { NextRequest, NextResponse } from 'next/server';

import { cancelCaptionBatch } from '@/app/services/auto-tagger/providers/vlm/client';

export async function POST(request: NextRequest) {
  try {
    const { batchId } = await request.json();
    if (!batchId || typeof batchId !== 'string') {
      return NextResponse.json(
        { error: 'batchId is required' },
        { status: 400 },
      );
    }

    // Best-effort: a 404 on the sidecar just means the batch already ended
    // (or was an ONNX batch that never touched the sidecar).
    await cancelCaptionBatch(batchId);
    return NextResponse.json({ status: 'cancelling' });
  } catch {
    return NextResponse.json(
      { error: 'Failed to cancel batch' },
      { status: 500 },
    );
  }
}
