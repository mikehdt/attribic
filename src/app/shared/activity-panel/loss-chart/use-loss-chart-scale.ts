import { useMemo } from 'react';

import type {
  LossPoint,
  TrainingProvider,
} from '@/app/services/training/types';

/**
 * How hard the trend line pulls the noise in. A stronger setting reads as a
 * cleaner story, which is exactly why it's exposed rather than fixed — the
 * honest way to use it is to check whether a trend survives being loosened.
 */
export type SmoothingLevel = 'off' | 'light' | 'medium' | 'heavy' | 'max';

export const DEFAULT_SMOOTHING: SmoothingLevel = 'medium';

export const SMOOTHING_OPTIONS: { value: SmoothingLevel; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'light', label: 'Light' },
  { value: 'medium', label: 'Medium' },
  { value: 'heavy', label: 'Heavy' },
  { value: 'max', label: 'Max' },
];

type UseLossChartScaleArgs = {
  lossHistory: LossPoint[];
  totalSteps: number;
  /** Backend that produced the series — decides how much smoothing it needs. */
  provider?: TrainingProvider;
  /** Trend-line strength; 'off' drops the overlay entirely. */
  smoothing?: SmoothingLevel;
  width: number;
  height: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
};

/** Minimum points before an EMA overlay says anything the raw line doesn't. */
const MIN_POINTS_FOR_SMOOTHING = 8;

/**
 * Base EMA weight per backend, because the two report fundamentally different
 * things under the same name:
 *
 * - **kohya** reports `avr_loss` — sd-scripts' own moving average across the
 *   epoch. The series arrives pre-averaged, so it needs only a light pass;
 *   smoothing it hard would flatten movement that is already real signal.
 * - **ai-toolkit** logs *raw per-step* loss to `loss_log.db`, which is what we
 *   read. On flow-matching models each step draws a random timestep, and loss
 *   varies far more with that draw than with training progress — so the raw
 *   series is inherently noisy (very visibly so on Z-Image Turbo) and needs
 *   real smoothing to read as a trend. ai-toolkit's own graph faces the same
 *   data and does the same thing: its default view is smoothed, over a heavier
 *   trend line at alpha 0.005.
 *
 * These are the 'medium' weights; `SMOOTHING_FACTOR` scales them from there.
 */
const EMA_ALPHA: Record<TrainingProvider, number> = {
  'ai-toolkit': 0.07,
  mock: 0.07,
  kohya: 0.22,
};
const DEFAULT_EMA_ALPHA = 0.07;

/**
 * Multipliers on the backend's base weight, so every level stays relative to
 * how noisy that backend's series actually is. Smaller alpha = longer window =
 * smoother line: as a rough guide the averaging window is ~2/alpha points, so
 * on ai-toolkit these run from ~9 points (light) to ~190 (max).
 */
const SMOOTHING_FACTOR: Record<Exclude<SmoothingLevel, 'off'>, number> = {
  light: 2.5,
  medium: 1,
  heavy: 0.4,
  max: 0.15,
};

/**
 * A "nice" rounding step (1/2/5 × 10^n). Fine-grained (≈8 steps over the
 * range) — only three ticks get labelled, so a finer step costs nothing and
 * keeps the domain snug against the data.
 */
function niceStep(range: number): number {
  if (!Number.isFinite(range) || range <= 0) return 1;
  const rough = range / 8;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalised = rough / magnitude;
  const nice =
    normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return nice * magnitude;
}

/**
 * Y-domain fitted to where the loss actually sits, so a curve hovering
 * around 0.05 doesn't render as a flat line at the bottom of a 0–0.1 plot.
 *
 * - Top: clamped just above the 95th percentile — warmup/first-batch spikes
 *   clip at the top edge instead of distorting the whole scale.
 * - Bottom: raised off zero (to a nice tick below the 5th percentile) only
 *   when the data floats well clear of it; otherwise the zero baseline stays.
 */
function computeDomain(losses: number[]): { yMin: number; yMax: number } {
  if (losses.length === 0) return { yMin: 0, yMax: 1 };
  const sorted = [...losses].sort((a, b) => a - b);
  const at = (frac: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * frac))];

  const max = sorted[sorted.length - 1];
  let hi = Math.min(max, at(0.95) * 1.15);
  let lo = at(0.05);
  if (hi <= lo) {
    // Flat (or single-point) series — pad so the line sits mid-plot.
    hi = lo > 0 ? lo * 1.1 : 1;
    lo = lo > 0 ? lo * 0.9 : 0;
  }

  const zoomed = lo > hi * 0.25;
  const step = niceStep(hi - (zoomed ? lo : 0));
  return {
    yMin: zoomed ? Math.max(0, Math.floor(lo / step) * step) : 0,
    yMax: Math.ceil(hi / step) * step,
  };
}

/**
 * One debiased EMA pass. Each output is divided by `w = 1-(1-alpha)^n` so the
 * early values read as a running mean rather than an accumulator warming up
 * from zero; `w` is returned too, doubling as a confidence weight (→0 with one
 * point seen, →1 once warmed up). `reverse` walks the series back to front.
 */
function emaPass(
  losses: number[],
  alpha: number,
  reverse: boolean,
): { values: number[]; weights: number[] } {
  const values = new Array<number>(losses.length);
  const weights = new Array<number>(losses.length);
  let acc = 0;
  const start = reverse ? losses.length - 1 : 0;
  const step = reverse ? -1 : 1;
  for (let i = start, n = 0; i >= 0 && i < losses.length; i += step) {
    acc = alpha * losses[i] + (1 - alpha) * acc;
    n += 1;
    const w = 1 - (1 - alpha) ** n;
    values[i] = acc / w;
    weights[i] = w;
  }
  return { values, weights };
}

/**
 * Zero-phase (forward-backward) EMA, blended by each pass's confidence weight.
 *
 * A single causal EMA — what this used to be — lags the data by roughly its
 * window, which on a falling loss curve reads as the trend line sitting
 * persistently above the points it is meant to describe, and pins the first
 * value to its own raw (unsmoothed) reading. Running the average both ways and
 * weighting each index by how much data that pass had seen cancels the lag:
 * at the start the forward pass has ~1 point and the backward, future-informed
 * pass dominates; at the live end it is the other way round; the middle is
 * ~50/50. Same construction ai-toolkit's own loss graph uses.
 */
function smoothLosses(losses: number[], alpha: number): number[] {
  const forward = emaPass(losses, alpha, false);
  const backward = emaPass(losses, alpha, true);
  return losses.map((_, i) => {
    const wf = forward.weights[i];
    const wb = backward.weights[i];
    const total = wf + wb;
    return total > 0
      ? (wf * forward.values[i] + wb * backward.values[i]) / total
      : (forward.values[i] + backward.values[i]) / 2;
  });
}

/** Shared scale maths for the compact and detail loss chart variants. */
export function useLossChartScale({
  lossHistory,
  totalSteps,
  provider,
  smoothing = DEFAULT_SMOOTHING,
  width,
  height,
  paddingTop,
  paddingRight,
  paddingBottom,
  paddingLeft,
}: UseLossChartScaleArgs) {
  return useMemo(() => {
    const innerWidth = Math.max(1, width - paddingLeft - paddingRight);
    const innerHeight = Math.max(1, height - paddingTop - paddingBottom);

    const steps = lossHistory.map((p) => p.step);
    const losses = lossHistory.map((p) => p.loss);
    const maxObservedStep = steps.length > 0 ? Math.max(...steps) : 0;
    const xMax = totalSteps > 0 ? totalSteps : Math.max(1, maxObservedStep);
    const { yMin, yMax } = computeDomain(losses);

    const xScale = (step: number) =>
      paddingLeft + (Math.min(Math.max(step, 0), xMax) / xMax) * innerWidth;

    const yScale = (loss: number) =>
      paddingTop +
      (1 - (Math.min(Math.max(loss, yMin), yMax) - yMin) / (yMax - yMin)) *
        innerHeight;

    const toPath = (values: number[]) =>
      values
        .map(
          (loss, i) =>
            `${i === 0 ? 'M' : 'L'}${xScale(lossHistory[i].step)},${yScale(loss)}`,
        )
        .join(' ');

    const base = (provider && EMA_ALPHA[provider]) ?? DEFAULT_EMA_ALPHA;
    const linePath = lossHistory.length >= 2 ? toPath(losses) : null;
    const smoothedPath =
      smoothing !== 'off' && lossHistory.length >= MIN_POINTS_FOR_SMOOTHING
        ? toPath(
            smoothLosses(
              losses,
              Math.min(1, base * SMOOTHING_FACTOR[smoothing]),
            ),
          )
        : null;

    const yTicks = [yMin, (yMin + yMax) / 2, yMax];

    return {
      innerWidth,
      innerHeight,
      xMax,
      yMin,
      yMax,
      yTicks,
      xScale,
      yScale,
      linePath,
      smoothedPath,
    };
  }, [
    lossHistory,
    totalSteps,
    provider,
    smoothing,
    width,
    height,
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft,
  ]);
}
