import { NextResponse } from 'next/server';

import {
  buildSidecarStartRequest,
  type TrainingStartBody,
} from '@/app/services/training/build-sidecar-request';
import { ensureSidecar } from '@/app/services/training/sidecar-manager';

/**
 * POST /api/training/start — Start a training job via the Python sidecar.
 *
 * The request body is the raw client-side form config. This route assembles
 * the sidecar-shaped StartJobRequest (absolute paths, snake_case) before
 * forwarding.
 */
export async function POST(request: Request) {
  const sidecar = await ensureSidecar();
  if (sidecar.status !== 'ready') {
    return NextResponse.json(
      { error: `Sidecar not ready: ${sidecar.error}` },
      { status: 503 },
    );
  }

  try {
    const clientConfig = (await request.json()) as TrainingStartBody;
    const body = buildSidecarStartRequest(clientConfig);
    const res = await fetch(`http://127.0.0.1:${sidecar.port}/jobs/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    // Echo the built request back so the client can seed Redux with the
    // exact config the sidecar received.
    return NextResponse.json(
      { ...data, sidecar_port: sidecar.port, sent_request: body },
      { status: res.status },
    );
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to start training: ${error}` },
      { status: 500 },
    );
  }
}
