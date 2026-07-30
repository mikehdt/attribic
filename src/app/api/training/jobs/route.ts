import { NextResponse } from 'next/server';

import { listJobRecords } from '@/app/services/training/job-records';

/**
 * GET /api/training/jobs — every training run on record.
 *
 * Read straight from `<training>/jobs/*.json`, which is where the sidecar keeps
 * the durable record of every run anyway. That's deliberate: the sidecar only
 * spawns on demand and idle-exits, so asking it would answer "no runs" for the
 * whole of a cold start — indistinguishable from an empty history, and
 * indistinguishable to the client from a real answer.
 *
 * The twin of `/api/training/status`, which returns only the single "focus" run
 * and stays sidecar-first because it answers what is running *now*. This one is
 * run history plus the queue: the client reconciles against it after its
 * progress WebSocket reconnects, where any of the queued / running /
 * just-finished runs may have moved on while the stream was down.
 */
/**
 * Never cached. This handler used to be dynamic only as a side effect of calling
 * the sidecar over `fetch`; a pure `fs` read with no dynamic API in play is
 * exactly the shape Next is free to evaluate once and serve forever, which would
 * freeze run history at whatever was on disk at build time. The sidecar rewrites
 * these files continuously (progress every few seconds, terminal transitions,
 * `_recover_state` on boot), so every request has to read them again.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  return NextResponse.json({ jobs: await listJobRecords() });
}
