/**
 * Read a tagging batch's SSE body as typed events.
 *
 * Both consumer loops (starting a batch, reattaching to one) hand-rolled this
 * framing — reader, decoder, buffer, `data: ` prefix, `JSON.parse` into `any` —
 * so the event shapes were untyped on the client while the routes built them
 * from a checked union on the server. This is the one place that framing lives,
 * and it hands back {@link TaggingSseEvent} so the compiler knows which fields
 * each event carries.
 *
 * A malformed frame is logged and skipped rather than killing the stream: the
 * remaining events still carry results worth staging.
 */

import type { TaggingSseEvent } from './types';

export async function* readTaggingSseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<TaggingSseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    // The last element is either an incomplete line or '' — either way it
    // belongs to the next chunk.
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const event = parseFrame(line);
      if (event) yield event;
    }
  }

  // A server that closes immediately after its last event can leave that
  // event in the buffer with no trailing newline. It's usually the `complete`
  // that decides whether the run is finalised, so it must not be dropped.
  const trailing = parseFrame(buffer);
  if (trailing) yield trailing;
}

function parseFrame(line: string): TaggingSseEvent | null {
  if (!line.startsWith('data: ')) return null;
  try {
    return JSON.parse(line.slice(6)) as TaggingSseEvent;
  } catch (err) {
    console.warn('Skipping malformed tagging SSE event:', line, err);
    return null;
  }
}
