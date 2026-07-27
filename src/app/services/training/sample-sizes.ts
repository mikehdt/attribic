/**
 * Per-prompt sample image shapes.
 *
 * Both backends accept `--w`/`--h` flags on a sample prompt line — sd-scripts
 * natively, and ai-toolkit mirrors the same syntax in `SampleConfig.
 * _process_prompt_string` — so a prompt's shape can travel with the prompt
 * instead of needing a per-backend config knob. The sidecar appends the flags;
 * the client only sends resolved pixel pairs.
 *
 * The form stores an aspect key rather than raw pixels so a shape stays
 * meaningful when the training resolution changes: "portrait" is 832 × 1216 on
 * a 1024 run and 416 × 608 on a 512 one, without the user re-picking it.
 */

export type SampleAspect =
  | 'portrait-tall'
  | 'portrait'
  | 'square'
  | 'landscape'
  | 'landscape-wide';

/** What a prompt gets when it has never been given a shape. */
export const DEFAULT_SAMPLE_ASPECT: SampleAspect = 'square';

/**
 * Ordered wide → tall so the dropdown reads as a spectrum with square in the
 * middle. Multipliers are relative to the run's base resolution and chosen so
 * a 1024 base lands exactly on the standard SDXL buckets.
 */
export const SAMPLE_ASPECTS: {
  value: SampleAspect;
  label: string;
  wMul: number;
  hMul: number;
}[] = [
  {
    value: 'landscape-wide',
    label: 'Wide landscape',
    wMul: 1.1875,
    hMul: 0.8125,
  },
  { value: 'landscape', label: 'Landscape', wMul: 1.125, hMul: 0.875 },
  { value: 'square', label: 'Square', wMul: 1, hMul: 1 },
  { value: 'portrait', label: 'Portrait', wMul: 0.875, hMul: 1.125 },
  { value: 'portrait-tall', label: 'Tall portrait', wMul: 0.8125, hMul: 1.1875 },
];

/**
 * The run's sampling baseline: a scalar the aspect multipliers work off, plus
 * the exact training crop when one is set. Kohya's native-resolution runs
 * deliberately sample at the training size rather than a square crop of it, so
 * that pair has to survive as its own thing — see `basePair` below.
 */
export type SampleBase = {
  scalar: number;
  native: [number, number] | null;
};

const snap64 = (value: number) => Math.max(64, Math.round(value / 64) * 64);

const NATIVE_RESOLUTION_RE = /^\s*(\d+)\s*[x×]\s*(\d+)\s*$/i;

/** Parse an exact `WxH` training size. Returns null for empty/malformed input. */
function parseNativeResolution(
  value: string | undefined | null,
): [number, number] | null {
  const match = NATIVE_RESOLUTION_RE.exec(value ?? '');
  if (!match) return null;
  const w = Number(match[1]);
  const h = Number(match[2]);
  return w > 0 && h > 0 ? [w, h] : null;
}

/**
 * Work out the sampling baseline from the run's resolution settings. The
 * scalar matches what the providers already use for square samples (the
 * largest configured bucket), or the equal-area square of an exact `WxH` crop.
 */
export function getSampleBase(
  resolution: number[] | number | undefined,
  nativeResolution?: string,
): SampleBase {
  const native = parseNativeResolution(nativeResolution);
  if (native) {
    return { scalar: snap64(Math.sqrt(native[0] * native[1])), native };
  }
  const buckets = Array.isArray(resolution)
    ? resolution
    : typeof resolution === 'number'
      ? [resolution]
      : [];
  const largest = buckets.length > 0 ? Math.max(...buckets) : 1024;
  return { scalar: largest > 0 ? largest : 1024, native: null };
}

/**
 * Resolve an aspect to pixels. `square` on a native-resolution run means
 * "whatever the run trains at", preserving the existing behaviour where an
 * exact `WxH` run samples at `WxH`; every other aspect is derived from the
 * scalar and snapped to a multiple of 64.
 */
export function resolveSampleSize(
  aspect: SampleAspect,
  base: SampleBase,
): [number, number] {
  if (aspect === 'square') {
    return base.native ?? [base.scalar, base.scalar];
  }
  const meta = SAMPLE_ASPECTS.find((a) => a.value === aspect);
  if (!meta) return [base.scalar, base.scalar];
  return [snap64(base.scalar * meta.wMul), snap64(base.scalar * meta.hMul)];
}

/**
 * Descriptive name for an aspect. The square entry renames itself on
 * native-resolution runs, where it isn't square at all.
 */
export function sampleAspectName(
  aspect: SampleAspect,
  base: SampleBase,
): string {
  if (aspect === 'square' && base.native) return 'Matches training';
  return SAMPLE_ASPECTS.find((a) => a.value === aspect)?.label ?? 'Square';
}
