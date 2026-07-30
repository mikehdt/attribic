/**
 * API Route: GET /api/auto-tagger/batch/attach?batchId=<id>
 *
 * Reattach to a tagging batch the browser lost its connection to (page
 * refresh, closed tab). Replays every per-image result accumulated so far,
 * then streams live progress — same SSE event vocabulary as the main
 * /api/auto-tagger/batch stream, so the client processes both with the same
 * code, whichever provider ran the batch.
 *
 * VLM batches are replayed from the sidecar's snapshot; ONNX batches from this
 * process's batch store. The id alone selects the source — the client doesn't
 * need to know which provider it's reattaching to.
 *
 * Detaching (aborting this stream) does NOT cancel the batch; use
 * POST /api/auto-tagger/batch/cancel for that.
 */

import { NextRequest } from 'next/server';
import path from 'path';

import { displayName } from '@/app/services/auto-tagger/display-name';
import { attachCaptionBatch } from '@/app/services/auto-tagger/providers/vlm/client';
import { translateVlmBatchEvents } from '@/app/services/auto-tagger/providers/vlm/sse-translate';
import {
  attachOnnxBatch,
  hasOnnxBatch,
} from '@/app/services/auto-tagger/providers/wd14/batch-store';
import type { TaggingSseEvent } from '@/app/services/auto-tagger/types';
import { getProjectsFolderOrDefault } from '@/app/services/config/server-config';

export async function GET(request: NextRequest) {
  const batchId = request.nextUrl.searchParams.get('batchId');
  if (!batchId) {
    return new Response(JSON.stringify({ error: 'batchId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  const isOnnx = hasOnnxBatch(batchId);

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: TaggingSseEvent) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };

      // Images processed so far. Replayed results and live per-image events
      // arrive through the same generator, so counting them reproduces the
      // batch's `current` exactly.
      let completed = 0;
      let total = 0;

      try {
        if (isOnnx) {
          for await (const event of attachOnnxBatch(batchId)) {
            if ('snapshot' in event) {
              total = event.total;
              continue;
            }

            if ('cancelled' in event) {
              sendEvent({ type: 'cancelled', current: completed, total });
              controller.close();
              return;
            }

            const { itemId, fileName, tags, error } = event.result;
            if (error != null) {
              sendEvent({ type: 'error', fileId: itemId, error });
            } else {
              sendEvent({ type: 'result', fileId: itemId, fileName, tags });
            }

            completed++;
            sendEvent({ type: 'progress', current: completed, total });
          }

          sendEvent({ type: 'complete', total });
          controller.close();
          return;
        }

        // Absolute path of the batch's project folder, from the sidecar
        // snapshot. Needed to name thumbnails project-relative — a bare
        // basename 404s for assets in repeat subfolders.
        let projectPath: string | undefined;
        // Processing order, also from the snapshot: the live route knows the
        // batch's items because it sent them, a reattach has to be told.
        let itemIds: string[] = [];

        // Shared with the translator, which advances `completed` per image and
        // fills in `total` once the snapshot lands.
        const counters = { total: 0, completed: 0 };

        for await (const event of translateVlmBatchEvents(
          attachCaptionBatch(batchId),
          {
            counters,
            onSnapshot: (snapshot) => {
              if (snapshot.project) {
                projectPath = path.resolve(
                  getProjectsFolderOrDefault(),
                  snapshot.project,
                );
              }
              itemIds = snapshot.itemIds ?? [];
            },
            // The sidecar stores the path each item resolved to (poster frame
            // or original image), so replayed results name a thumbnail
            // exactly like the live stream does.
            fileNameFor: ({ imagePath }) =>
              imagePath ? displayName(imagePath, projectPath) : undefined,
            itemIdAt: (index) => itemIds[index],
          },
        )) {
          sendEvent(event);
          if (event.type === 'cancelled') {
            controller.close();
            return;
          }
        }

        sendEvent({ type: 'complete', total: counters.total });
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
