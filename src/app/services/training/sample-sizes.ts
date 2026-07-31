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

import { parseNativeResolution } from './native-resolution';

export type SampleAspect =
  | 'native'
  | 'portrait-tall'
  | 'portrait'
  | 'square'
  | 'landscape'
  | 'landscape-wide';

/**
 * What a prompt gets when it has never been given a shape. Runs with an exact
 * `WxH` training size default to `native` instead — see `defaultSampleAspect`.
 */
export const DEFAULT_SAMPLE_ASPECT: SampleAspect = 'square';

/**
 * The proportional shapes, ordered wide → tall so the dropdown reads as a
 * spectrum with square in the middle. Multipliers are relative to the run's
 * base resolution and chosen so a 1024 base lands exactly on the standard SDXL
 * buckets. `native` isn't here — it's an exact size, not a ratio of the base.
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
  {
    value: 'portrait-tall',
    label: 'Tall portrait',
    wMul: 0.8125,
    hMul: 1.1875,
  },
];

/**
 * The run's sampling baseline: a scalar the aspect multipliers work off, plus
 * the exact training crop when one is set. Kohya's native-resolution runs
 * usually want to sample at the training size rather than a square of equal
 * area, so that pair has to survive as its own thing — it's what the `native`
 * aspect resolves to.
 */
export type SampleBase = {
  scalar: number;
  native: [number, number] | null;
};

const snap64 = (value: number) => Math.max(64, Math.round(value / 64) * 64);

/**
 * Work out the sampling baseline from the run's resolution settings. The
 * scalar matches what the providers already use for square samples (the
 * largest configured bucket), or the equal-area square of an exact `WxH` crop.
 */
export function getSampleBase(
  resolution: number[] | number | undefined,
  nativeResolution?: string,
): SampleBase {
  // Same parser the form validates with, so a size the form accepts always
  // reaches the sampling maths (a private regex here once missed `1280,768`).
  const { value } = parseNativeResolution(nativeResolution ?? '');
  if (value) {
    const native: [number, number] = [value.width, value.height];
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
 * Resolve an aspect to pixels. `native` is the exact training crop of a forced
 * `WxH` run; `square` is always genuinely square, so a forced-size run can
 * still sample at 1024 × 1024. Every other aspect is derived from the scalar
 * and snapped to a multiple of 64.
 */
export function resolveSampleSize(
  aspect: SampleAspect,
  base: SampleBase,
): [number, number] {
  if (aspect === 'native') return base.native ?? [base.scalar, base.scalar];
  if (aspect === 'square') return [base.scalar, base.scalar];
  const meta = SAMPLE_ASPECTS.find((a) => a.value === aspect);
  if (!meta) return [base.scalar, base.scalar];
  return [snap64(base.scalar * meta.wMul), snap64(base.scalar * meta.hMul)];
}

/** Descriptive name for an aspect. */
export function sampleAspectName(aspect: SampleAspect): string {
  if (aspect === 'native') return 'Matches training';
  return SAMPLE_ASPECTS.find((a) => a.value === aspect)?.label ?? 'Square';
}

/**
 * The aspects on offer for a run, in menu order. Forced-size runs gain a
 * `native` entry above the proportional shapes — but only when it would show
 * something the square entry doesn't, since a forced 1024 × 1024 *is* the
 * square option and listing both would just repeat the same pixels.
 */
export function getSampleAspects(base: SampleBase): SampleAspect[] {
  const shapes = SAMPLE_ASPECTS.map((a) => a.value);
  if (!base.native) return shapes;
  const [w, h] = base.native;
  if (w === h && w === base.scalar) return shapes;
  return ['native', ...shapes];
}

/**
 * The shape a prompt gets when it has none of its own. Forced-size runs keep
 * sampling at their training crop by default; everything else stays square.
 */
export function defaultSampleAspect(base: SampleBase): SampleAspect {
  return getSampleAspects(base).includes('native')
    ? 'native'
    : DEFAULT_SAMPLE_ASPECT;
}
