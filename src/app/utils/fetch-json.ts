/**
 * `fetch` for endpoints that must answer with JSON.
 *
 * Calling `res.json()` directly turns any non-JSON response into
 * `SyntaxError: unexpected character at line 1 column 1`, which says nothing
 * about what actually came back. That matters here because the thing most
 * likely to produce it isn't a handler bug at all: a Next dev server whose
 * route graph has gone stale serves its **HTML** 404 page for API routes that
 * exist on disk, and every caller then reports a parse error instead of "this
 * route didn't match".
 *
 * So the body is read as text first and only then parsed, letting the failure
 * name the status, the content type, and the first line of what arrived.
 */

/** How much of a non-JSON body to quote back. Enough to spot a `<!DOCTYPE`. */
const SNIPPET_LENGTH = 120;

/**
 * `not-json` — nothing parseable came back, so the request never reached a
 * handler of ours. `http-error` — a handler answered, and answered in JSON.
 *
 * Worth telling apart: a JSON 404 from `/api/training/projects/by-slug/...`
 * means no such project and the caller should say so, while an HTML 404 for
 * the same URL means the route didn't match and the project may well exist.
 */
type JsonResponseErrorKind = 'not-json' | 'http-error';

class JsonResponseError extends Error {
  constructor(
    readonly kind: JsonResponseErrorKind,
    readonly url: string,
    readonly status: number,
    readonly contentType: string | null,
    readonly bodySnippet: string,
    message: string,
  ) {
    super(message);
    this.name = 'JsonResponseError';
  }
}

/** Whether an error is a handler-issued JSON response with the given status. */
export function isJsonStatus(error: unknown, status: number): boolean {
  return (
    error instanceof JsonResponseError &&
    error.kind === 'http-error' &&
    error.status === status
  );
}

function snippet(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > SNIPPET_LENGTH
    ? `${collapsed.slice(0, SNIPPET_LENGTH)}…`
    : collapsed;
}

/**
 * Fetch and parse JSON, throwing a description of what came back instead when
 * the response isn't JSON or reports an error.
 *
 * An error body carrying `{ error }` surfaces that message, since our routes
 * use it for failures the user should read.
 */
export async function fetchJson<T>(
  input: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(input, init);
  const text = await res.text();
  const contentType = res.headers.get('content-type');

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new JsonResponseError(
      'not-json',
      input,
      res.status,
      contentType,
      snippet(text),
      `${input} returned ${res.status} as ${contentType ?? 'an unknown type'}, not JSON: ${snippet(text) || '(empty body)'}`,
    );
  }

  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error;
    throw new JsonResponseError(
      'http-error',
      input,
      res.status,
      contentType,
      snippet(text),
      message || `Request failed: ${res.status}`,
    );
  }

  return data as T;
}
