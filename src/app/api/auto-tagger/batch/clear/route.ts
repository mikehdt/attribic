/**
 * API Route: POST /api/auto-tagger/batch/clear
 *
 * Drop a terminal batch (and its stored results) once the client has flushed
 * the results — from the sidecar for VLM, from the in-process batch store for
 * ONNX. Keeps the batch lists from accumulating forever and stops
 * /batch/active re-surfacing batches the client already collected.
 */

import { NextRequest, NextResponse } from 'next/server';

import { clearCaptionBatch } from '@/app/services/auto-tagger/providers/vlm/client';
import {
  clearOnnxBatch,
  hasOnnxBatch,
} from '@/app/services/auto-tagger/providers/wd14/batch-store';

export async function POST(request: NextRequest) {
  try {
    const { batchId } = await request.json();
    if (!batchId || typeof batchId !== 'string') {
      return NextResponse.json(
        { error: 'batchId is required' },
        { status: 400 },
      );
    }

    // The id only ever exists in one store. Checked before clearing so an ONNX
    // id never falls through to the sidecar, which would answer 409 for an id
    // it has never heard of and strand the caller's clear poll.
    if (hasOnnxBatch(batchId)) {
      // A still-running ONNX batch refuses to clear — the caller cancels first
      // and retries once it goes terminal.
      if (!clearOnnxBatch(batchId)) {
        return NextResponse.json({ status: 'still-running' }, { status: 409 });
      }
      return NextResponse.json({ status: 'cleared' });
    }

    const result = await clearCaptionBatch(batchId);
    if (result === 'still-running') {
      return NextResponse.json({ status: 'still-running' }, { status: 409 });
    }
    // 'not-found'/'unreachable' both mean nothing is left to resurface: the
    // sidecar's batches die with it, so a gone sidecar is as good as cleared.
    return NextResponse.json({ status: 'cleared' });
  } catch {
    return NextResponse.json(
      { error: 'Failed to clear batch' },
      { status: 500 },
    );
  }
}
