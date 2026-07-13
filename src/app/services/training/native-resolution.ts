/**
 * Parsing for the Kohya-only exact `WxH` training size (e.g. `'1280x768'`).
 *
 * Mirrors `_parse_native_resolution` in the sidecar's Kohya provider — the two
 * must accept the same inputs, since the sidecar rejects what this lets past.
 */

export type NativeResolution = { width: number; height: number };

const NATIVE_RESO_RE = /^(\d+)\s*[x×,]\s*(\d+)$/i;

/**
 * Returns the parsed size, or an `error` message for invalid input. An empty
 * string is "unset", not an error — the field is optional.
 */
export function parseNativeResolution(raw: string): {
  value: NativeResolution | null;
  error: string | null;
} {
  const trimmed = raw.trim();
  if (!trimmed) return { value: null, error: null };

  const match = NATIVE_RESO_RE.exec(trimmed);
  if (!match) {
    return { value: null, error: 'Use the form WxH, e.g. 1280x768' };
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) {
    return { value: null, error: 'Both dimensions must be greater than zero' };
  }
  // The VAE downsamples by 8x; sd-scripts silently rounds off-grid sizes, which
  // would defeat the point of asking for an exact size.
  if (width % 8 || height % 8) {
    return { value: null, error: 'Both dimensions must be divisible by 8' };
  }

  return { value: { width, height }, error: null };
}
