/**
 * Translate a VLM batch's sidecar events into the SSE vocabulary the client
 * speaks ({@link TaggingSseEvent}).
 *
 * Both `/api/auto-tagger/batch` (live) and `/api/auto-tagger/batch/attach`
 * (reattach) used to carry their own copy of this mapping, and they had
 * already drifted: the live route stamped `fileId` on `progress`/`loaded`
 * events and the attach route didn't, so a reattached client lost its
 * "currently processing" label. One translator, two thin callers.
 *
 * What the callers still own is where the per-event *context* comes from — the
 * live route knows the batch's items because it sent them, while a reattach
 * learns them from the sidecar snapshot.
 */

import type { TaggingSseEvent } from '../../types';
import type { BatchEvent, SnapshotStatus } from './client';

/**
 * Counters shared with the caller. The translator advances them; the caller
 * reads `total` afterwards (a reattach only learns it from the snapshot) and
 * seeds `completed` when some images are already accounted for.
 */
export type BatchCounters = {
  total: number;
  /** Images finished so far, successes and failures alike. */
  completed: number;
};

type TranslateContext = {
  counters: BatchCounters;
  /**
   * The file a result should render its thumbnail from — a poster frame for
   * video, the image itself otherwise. See `displayName`.
   */
  fileNameFor: (event: {
    itemId: string;
    imagePath?: string;
  }) => string | undefined;
  /**
   * The batch's nth item id in processing order, for the "currently
   * processing" label. Undefined past the end of the batch.
   */
  itemIdAt?: (index: number) => string | undefined;
  /** Called with the reattach snapshot before any of its results translate. */
  onSnapshot?: (snapshot: SnapshotStatus) => void;
};

export async function* translateVlmBatchEvents(
  source: AsyncGenerator<BatchEvent | SnapshotStatus>,
  { counters, fileNameFor, itemIdAt, onSnapshot }: TranslateContext,
): AsyncGenerator<TaggingSseEvent> {
  // Images the caller counted before the sidecar ran (videos whose poster
  // extraction failed). `itemIdAt` indexes the sidecar's item list, which
  // doesn't include them.
  const preCounted = counters.completed;
  const nextItemId = () => itemIdAt?.(counters.completed - preCounted);

  for await (const event of source) {
    if ('snapshot' in event) {
      counters.total = event.total;
      // `completed` is deliberately left alone: the snapshot's replayed
      // results come through this same loop and counting them reproduces the
      // batch's `current` exactly.
      onSnapshot?.(event);
      // A batch still in the queue reports its place immediately, so the UI
      // shows "Queued — position N" rather than a stalled progress bar.
      if (event.status === 'queued' && event.position) {
        yield {
          type: 'queued',
          position: event.position,
          current: counters.completed,
          total: counters.total,
        };
      }
      continue;
    }

    if ('queued' in event) {
      yield {
        type: 'queued',
        position: event.position,
        current: counters.completed,
        total: counters.total,
      };
      continue;
    }

    // Model load progress is a side-channel: its current/total count shards,
    // and it never advances the image counter.
    if ('loading' in event) {
      yield {
        type: 'loading',
        message: event.message,
        current: event.current,
        total: event.total,
      };
      continue;
    }

    // The client fills its loading bar, pauses, then switches to the image
    // counter — doing that dance server-side would hold the stream open
    // while the sidecar starts inference.
    if ('loadingComplete' in event) {
      yield {
        type: 'loaded',
        current: counters.completed,
        total: counters.total,
        fileId: nextItemId(),
      };
      continue;
    }

    // Sidecar-side cancellation (queue removal, a cancel from another tab).
    // Said explicitly, because a bare `complete` made a cancelled batch look
    // like a finished one.
    if ('cancelled' in event) {
      yield {
        type: 'cancelled',
        current: counters.completed,
        total: counters.total,
      };
      return;
    }

    if ('error' in event) {
      yield { type: 'error', fileId: event.itemId, error: event.error };
    } else {
      yield {
        type: 'result',
        fileId: event.itemId,
        fileName: fileNameFor(event),
        caption: event.caption,
      };
    }

    counters.completed++;
    yield {
      type: 'progress',
      current: counters.completed,
      total: counters.total,
      // Items are processed in order, so the next one is what's in flight.
      // Past the last item there is no next: name the one just finished
      // rather than blanking the label.
      fileId: nextItemId() ?? ('itemId' in event ? event.itemId : undefined),
    };
  }
}
