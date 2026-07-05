/**
 * API Route: GET /api/auto-tagger/batch/attach?batchId=<id>
 *
 * Reattach to a caption batch the browser lost its connection to (page
 * refresh, closed tab). Replays every per-image result the sidecar has
 * accumulated, then streams live progress — same SSE event vocabulary as
 * the main /api/auto-tagger/batch stream, so the client processes both
 * with the same code.
 *
 * Detaching (aborting this stream) does NOT cancel the batch; use
 * POST /api/auto-tagger/batch/cancel for that.
 */

import { NextRequest } from 'next/server';

import { attachCaptionBatch } from '@/app/services/auto-tagger/providers/vlm/client';

export async function GET(request: NextRequest) {
  const batchId = request.nextUrl.searchParams.get('batchId');
  if (!batchId) {
    return new Response(JSON.stringify({ error: 'batchId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };

      // Images processed so far. The snapshot's stored results and the live
      // per-image events arrive through the same generator, so counting
      // result/error events reproduces the sidecar's `current` exactly.
      let completed = 0;
      let total = 0;

      try {
        for await (const event of attachCaptionBatch(batchId)) {
          if ('snapshot' in event) {
            total = event.total;
            if (event.status === 'queued' && event.position) {
              sendEvent({
                type: 'queued',
                position: event.position,
                current: 0,
                total,
              });
            }
            continue;
          }

          if ('queued' in event) {
            sendEvent({
              type: 'queued',
              position: event.position,
              current: completed,
              total,
            });
            continue;
          }

          if ('loading' in event) {
            sendEvent({
              type: 'loading',
              message: event.message,
              current: event.current,
              total: event.total,
            });
            continue;
          }

          if ('loadingComplete' in event) {
            sendEvent({ type: 'loaded', current: completed, total });
            continue;
          }

          if ('cancelled' in event) {
            sendEvent({ type: 'cancelled', current: completed, total });
            controller.close();
            return;
          }

          if ('error' in event) {
            sendEvent({
              type: 'error',
              fileId: event.itemId,
              error: event.error,
            });
          } else {
            sendEvent({
              type: 'result',
              fileId: event.itemId,
              caption: event.caption,
            });
          }

          completed++;
          sendEvent({ type: 'progress', current: completed, total });
        }

        sendEvent({ type: 'complete', total });
        controller.close();
      } catch (err) {
        try {
          sendEvent({
            type: 'error',
            error: err instanceof Error ? err.message : 'Reattach failed',
          });
          controller.close();
        } catch {
          // Client already disconnected — nothing to report to.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
