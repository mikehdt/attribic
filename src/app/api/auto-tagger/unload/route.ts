/**
 * API Route: POST /api/auto-tagger/unload
 * Release cached tagger models from GPU/CPU memory.
 *
 * Covers both backends, because "release GPU memory" means all of it from
 * the user's point of view — the ONNX sessions held in this process's worker
 * thread, and any VLM the sidecar has resident. Each side is attempted
 * independently so one failing doesn't hide the other's success.
 *
 * Uses connectSidecar rather than ensureSidecar: booting a Python server as
 * a side effect of asking to free memory is never what the user meant. If no
 * sidecar is running there is nothing of its to unload.
 */

import { NextResponse } from 'next/server';

import { unloadWorkerModels } from '@/app/services/auto-tagger/providers/wd14/worker-manager';
import { connectSidecar } from '@/app/services/training/sidecar-manager';

export async function POST() {
  const released: { onnx: boolean; vlm: boolean } = { onnx: false, vlm: false };
  const errors: string[] = [];

  // ONNX — in-process worker thread
  try {
    released.onnx = await unloadWorkerModels();
  } catch (err) {
    errors.push(
      `ONNX: ${err instanceof Error ? err.message : 'failed to release sessions'}`,
    );
  }

  // VLM — Python sidecar
  try {
    const sidecar = await connectSidecar();
    if (sidecar.status === 'ready') {
      const res = await fetch(
        `http://127.0.0.1:${sidecar.port}/caption/unload`,
        { method: 'POST' },
      );

      if (res.ok) {
        released.vlm = true;
      } else {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        errors.push(`VLM: ${body.error ?? `sidecar returned ${res.status}`}`);
      }
    }
  } catch (err) {
    errors.push(
      `VLM: ${err instanceof Error ? err.message : 'failed to reach sidecar'}`,
    );
  }

  if (errors.length > 0) {
    return NextResponse.json(
      { error: errors.join('; '), released },
      { status: 500 },
    );
  }

  return NextResponse.json({ status: 'unloaded', released });
}
