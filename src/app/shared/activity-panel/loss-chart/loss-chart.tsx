import { memo, useMemo } from 'react';

import type {
  LossPoint,
  TrainingProvider,
} from '@/app/services/training/types';

import {
  formatLoss,
  splitPrunedCheckpoints,
  trimSettleSteps,
} from '../helpers';
import { useLossChartScale } from './use-loss-chart-scale';

type LossChartVariant = 'compact' | 'detail';

type LossChartProps = {
  lossHistory: LossPoint[];
  totalSteps: number;
  currentStep: number;
  /** Total epochs — drives the light epoch gridlines. */
  totalEpochs?: number;
  /** Predicted checkpoint positions (reached and upcoming). */
  checkpointSteps?: number[];
  /** Steps confirmed written by the trainer. */
  savedCheckpoints?: number[];
  /** Predicted sample-generation positions (reached and upcoming). */
  sampleSteps?: number[];
  /** Steps that have actually produced sample images on disk. */
  generatedSampleSteps?: number[];
  /** True while the trainer is paused generating sample images right now. */
  generatingSample?: boolean;
  /**
   * Rolling checkpoint window from the run's config. When > 0 the trainer
   * keeps only the last N saves, so earlier ones are drawn as pruned.
   */
  maxSavesToKeep?: number;
  /** Backend that ran the job — its save cadence decides which files survive. */
  provider?: TrainingProvider;
  /**
   * Normalised (0–1) LR schedule curve drawn as a background area across
   * the full step range.
   */
  lrCurve?: number[] | null;
  variant?: LossChartVariant;
  width: number;
  height: number;
  className?: string;
};

const DETAIL_PADDING = { top: 10, right: 12, bottom: 20, left: 42 };
const COMPACT_PADDING = { top: 2, right: 2, bottom: 2, left: 2 };

const X_TICK_FRACTIONS = [0, 0.25, 0.5, 0.75, 1];

// Series colours are fixed (not currentColor) — validated for CVD separation
// and contrast against the chart surfaces in both light and dark mode:
// loss emerald-600, smoothed trend amber-600, LR schedule sky-600,
// saved checkpoints violet (slate once pruned by the rolling save window),
// epoch boundaries light slate, sample markers pink.

/**
 * Height of the marker lane reserved above the plot for sample dots, so they
 * never collide with a loss curve that runs up against the top of its domain.
 * Only added when the run actually samples.
 */
const SAMPLE_LANE = { detail: 9, compact: 5 };
const SAMPLE_DOT_RADIUS = { detail: 2.5, compact: 1.5 };

/**
 * Thin out markers that would overlap, keeping the earliest of any cluster —
 * a dense sampling cadence on a narrow chart should read as a sparse rhythm
 * rather than a solid smear. Input must be ascending.
 */
function spaceOutMarkers(
  steps: number[],
  xScale: (step: number) => number,
  minGap: number,
): number[] {
  const kept: number[] = [];
  let lastX = -Infinity;
  for (const step of steps) {
    const x = xScale(step);
    if (x - lastX < minGap) continue;
    kept.push(step);
    lastX = x;
  }
  return kept;
}

const LossChartComponent = ({
  lossHistory,
  totalSteps,
  currentStep,
  totalEpochs = 0,
  checkpointSteps = [],
  savedCheckpoints = [],
  sampleSteps = [],
  generatedSampleSteps = [],
  generatingSample = false,
  maxSavesToKeep = 0,
  provider,
  lrCurve = null,
  variant = 'compact',
  width,
  height,
  className = '',
}: LossChartProps) => {
  const isDetail = variant === 'detail';
  const padding = isDetail ? DETAIL_PADDING : COMPACT_PADDING;

  // Sample markers sit in their own lane above the plot, which only exists for
  // runs that sample — everything below is measured from `plotTop`, not the
  // raw padding, so a non-sampling run keeps the full height for the curve.
  const hasSampleLane =
    sampleSteps.length > 0 ||
    generatedSampleSteps.length > 0 ||
    generatingSample;
  const laneHeight = hasSampleLane
    ? isDetail
      ? SAMPLE_LANE.detail
      : SAMPLE_LANE.compact
    : 0;
  const plotTop = padding.top + laneHeight;
  const sampleDotRadius = isDetail
    ? SAMPLE_DOT_RADIUS.detail
    : SAMPLE_DOT_RADIUS.compact;
  const sampleDotY = padding.top + laneHeight / 2;

  // Hide the leading warmup spike so it doesn't squash the rest of the curve.
  const visibleHistory = useMemo(
    () => trimSettleSteps(lossHistory),
    [lossHistory],
  );

  const {
    innerWidth,
    innerHeight,
    xScale,
    yScale,
    xMax,
    yTicks,
    linePath,
    smoothedPath,
  } = useLossChartScale({
    lossHistory: visibleHistory,
    totalSteps,
    width,
    height,
    paddingTop: plotTop,
    paddingRight: padding.right,
    paddingBottom: padding.bottom,
    paddingLeft: padding.left,
  });

  // Empty series: a subtle placeholder, never a NaN'd path.
  if (visibleHistory.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={`inline-block ${className}`}
      >
        {isDetail ? (
          <text
            x={width / 2}
            y={height / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-slate-400 text-xs"
          >
            No loss data yet
          </text>
        ) : (
          <line
            x1={padding.left}
            x2={width - padding.right}
            y1={height / 2}
            y2={height / 2}
            stroke="currentColor"
            strokeWidth={1}
            strokeDasharray="2,3"
            className="opacity-25"
          />
        )}
      </svg>
    );
  }

  // Upcoming checkpoints that haven't been reached (and weren't confirmed
  // saved already — a provider may confirm a save ahead of its predicted
  // position). Reached-but-unconfirmed predictions aren't drawn at all, to
  // avoid implying a save that may not have happened.
  const upcomingCheckpoints = checkpointSteps.filter(
    (step) => step > currentStep && !savedCheckpoints.includes(step),
  );

  const { pruned: prunedCheckpoints, live: liveCheckpoints } =
    splitPrunedCheckpoints({
      savedCheckpoints,
      maxSavesToKeep,
      provider,
      totalSteps,
      currentStep,
    });

  // Epoch boundaries as light gridlines, at the trainer's actual per-epoch
  // step (same ceil-based math as deriveCheckpointSteps), excluding the run's
  // end which is the plot's right edge. A boundary that lands on a drawn
  // checkpoint line is dropped — the checkpoint takes precedence, since in
  // epoch-save mode every save sits on an epoch boundary.
  const epochLines: { x: number; passed: boolean }[] = [];
  if (totalEpochs >= 2 && xMax > 0) {
    const stepsPerEpoch = Math.max(1, Math.ceil(xMax / totalEpochs));
    const drawnCheckpointXs = [...upcomingCheckpoints, ...savedCheckpoints].map(
      (step) => xScale(step),
    );
    for (let e = 1; e < totalEpochs; e++) {
      const step = Math.min(e * stepsPerEpoch, xMax);
      const x = xScale(step);
      if (drawnCheckpointXs.some((cx) => Math.abs(cx - x) < 4)) continue;
      epochLines.push({ x, passed: step <= currentStep });
    }
  }

  const lineTop = plotTop;
  const lineBottom = height - padding.bottom;

  // The run's end is itself the final checkpoint — a violet line always sits on
  // the plot's right edge (dashed until the trainer confirms the save, solid
  // once written), even when no other checkpoints exist. Any other checkpoint
  // line that maps to the same edge is dropped so it isn't drawn twice.
  const rightEdgeX = width - padding.right;
  const atRightEdge = (step: number) => Math.abs(xScale(step) - rightEdgeX) < 4;
  const finalCheckpointSaved = savedCheckpoints.some(atRightEdge);

  // Sample markers: images already on disk read solid, predictions ahead of us
  // read faded — the point is seeing when the next one lands, so the upcoming
  // pass is spaced out from the earliest (i.e. the next one is never the dot
  // that gets thinned away). Predicted-but-passed positions with no image are
  // dropped, same as unconfirmed checkpoints.
  const markerGap = sampleDotRadius * 2 + 1.5;
  const generatedDots = spaceOutMarkers(
    [...generatedSampleSteps].sort((a, b) => a - b),
    xScale,
    markerGap,
  );
  const upcomingDots = spaceOutMarkers(
    sampleSteps
      .filter(
        (step) => step > currentStep && !generatedSampleSteps.includes(step),
      )
      .sort((a, b) => a - b),
    xScale,
    markerGap,
  );

  // The generation happening right now. Its position has been passed but no
  // image exists yet, so the rules above drop it — draw it pulsing instead,
  // the same "working" cue the running-job status dot uses. Falls back to the
  // current step when the backend reports no predicted positions at all.
  const generatingStep = generatingSample
    ? ([...sampleSteps]
        .sort((a, b) => a - b)
        .filter(
          (step) => step <= currentStep && !generatedSampleSteps.includes(step),
        )
        .pop() ?? currentStep)
    : null;

  const lastPoint = visibleHistory[visibleHistory.length - 1];

  // LR schedule background: curve points spread across the full plot width,
  // normalised so peak LR touches the top edge. Rendered as a faint fill
  // with a slightly stronger top edge carrying the shape.
  const lrPoints =
    lrCurve && lrCurve.length >= 2
      ? lrCurve.map((v, i) => {
          const x = padding.left + (i / (lrCurve.length - 1)) * innerWidth;
          const y = plotTop + (1 - v) * innerHeight;
          return `${x},${y}`;
        })
      : null;
  const plotBottom = height - padding.bottom;
  const lrAreaPath = lrPoints
    ? `M${padding.left},${plotBottom} L${lrPoints.join(' L')} L${padding.left + innerWidth},${plotBottom} Z`
    : null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`inline-block ${className}`}
    >
      {lrAreaPath && lrPoints && (
        <>
          <path d={lrAreaPath} className="fill-sky-600/10" />
          <polyline
            points={lrPoints.join(' ')}
            fill="none"
            strokeWidth={1}
            className="stroke-sky-600/40"
          />
        </>
      )}

      {/* Y axis: closes the left edge of the plot at step 0. */}
      <line
        x1={padding.left}
        x2={padding.left}
        y1={lineTop}
        y2={lineBottom}
        strokeWidth={1}
        className="stroke-slate-200 dark:stroke-slate-700"
      />

      {isDetail && (
        <>
          {/* Y gridlines + ticks (domain min / mid / max) */}
          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={yScale(tick)}
                y2={yScale(tick)}
                strokeWidth={1}
                className="stroke-slate-200 dark:stroke-slate-700"
              />
              <text
                x={padding.left - 6}
                y={yScale(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-slate-400 text-[10px] tabular-nums"
              >
                {formatLoss(tick)}
              </text>
            </g>
          ))}

          {/* X ticks (step positions) */}
          {X_TICK_FRACTIONS.map((frac) => {
            const step = Math.round(xMax * frac);
            return (
              <text
                key={frac}
                x={xScale(step)}
                y={height - padding.bottom + 14}
                textAnchor="middle"
                className="fill-slate-400 text-[10px] tabular-nums"
              >
                {step.toLocaleString()}
              </text>
            );
          })}
        </>
      )}

      {/* Epoch boundaries: light grey, sit behind the checkpoint lines, which
          take precedence where the two coincide. Passed epochs solidify;
          upcoming ones stay dashed. Rendered in both variants. */}
      {epochLines.map(({ x, passed }, i) => (
        <line
          key={`epoch-${i}`}
          x1={x}
          x2={x}
          y1={lineTop}
          y2={lineBottom}
          strokeWidth={1}
          strokeDasharray={passed ? undefined : '2,3'}
          className="stroke-slate-300/70 dark:stroke-slate-600/60"
        />
      ))}

      {/* Upcoming checkpoints: dashed, faded violet — same family as the
          solid saved-checkpoint lines, distinct from the grey epoch grid. */}
      {upcomingCheckpoints
        .filter((step) => !atRightEdge(step))
        .map((step) => (
          <line
            key={`upcoming-${step}`}
            x1={xScale(step)}
            x2={xScale(step)}
            y1={lineTop}
            y2={lineBottom}
            strokeWidth={1}
            strokeDasharray="2,3"
            className="stroke-violet-500/70 dark:stroke-violet-400/70"
          />
        ))}

      {/* Pruned by the rolling save window — no longer on disk, so they drop
          back to solid slate rather than the live-checkpoint violet. */}
      {prunedCheckpoints
        .filter((step) => !atRightEdge(step))
        .map((step) => (
          <line
            key={`pruned-${step}`}
            x1={xScale(step)}
            x2={xScale(step)}
            y1={lineTop}
            y2={lineBottom}
            strokeWidth={1}
            className="stroke-slate-400/70 dark:stroke-slate-500/70"
          />
        ))}

      {/* Confirmed checkpoint saves still on disk: solid */}
      {liveCheckpoints
        .filter((step) => !atRightEdge(step))
        .map((step) => (
          <line
            key={`saved-${step}`}
            x1={xScale(step)}
            x2={xScale(step)}
            y1={lineTop}
            y2={lineBottom}
            strokeWidth={1}
            className="stroke-violet-500/70 dark:stroke-violet-400/70"
          />
        ))}

      {/* Final checkpoint: always on the right edge (the run's end save).
          Dashed until confirmed written, solid once saved. */}
      <line
        x1={rightEdgeX}
        x2={rightEdgeX}
        y1={lineTop}
        y2={lineBottom}
        strokeWidth={1}
        strokeDasharray={finalCheckpointSaved ? undefined : '2,3'}
        className="stroke-violet-500/70 dark:stroke-violet-400/70"
      />

      {/* Raw loss: recedes when the smoothed trend line carries the shape. */}
      {linePath ? (
        <path
          d={linePath}
          fill="none"
          strokeWidth={smoothedPath ? (isDetail ? 1.5 : 1) : isDetail ? 2 : 1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={
            smoothedPath ? 'stroke-emerald-600/45' : 'stroke-emerald-600'
          }
        />
      ) : (
        <circle
          cx={xScale(lastPoint.step)}
          cy={yScale(lastPoint.loss)}
          r={isDetail ? 3 : 2}
          className="fill-emerald-600"
        />
      )}

      {/* Smoothed trend (debiased EMA) — the readable line over noisy loss. */}
      {smoothedPath && (
        <path
          d={smoothedPath}
          fill="none"
          strokeWidth={isDetail ? 2 : 1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="stroke-amber-600"
        />
      )}

      {/* Current-value end marker, with a surface ring so it reads clearly
          where the line meets it (detail variant only — compact stays a
          plain sparkline). */}
      {isDetail && linePath && (
        <circle
          cx={xScale(lastPoint.step)}
          cy={yScale(lastPoint.loss)}
          r={4}
          strokeWidth={2}
          className="fill-emerald-600 stroke-slate-100 dark:stroke-slate-900"
        />
      )}

      {/* Sample markers, in the reserved lane above the plot: faded for a
          predicted generation still ahead, solid once the images exist. */}
      {upcomingDots.map((step) => (
        <circle
          key={`sample-upcoming-${step}`}
          cx={xScale(step)}
          cy={sampleDotY}
          r={sampleDotRadius}
          className="fill-pink-500/30 dark:fill-pink-400/30"
        />
      ))}
      {generatedDots.map((step) => (
        <circle
          key={`sample-${step}`}
          cx={xScale(step)}
          cy={sampleDotY}
          r={sampleDotRadius}
          className="fill-pink-500 dark:fill-pink-400"
        />
      ))}
      {generatingStep !== null && (
        <circle
          cx={xScale(generatingStep)}
          cy={sampleDotY}
          r={sampleDotRadius}
          className="animate-pulse fill-pink-500 dark:fill-pink-400"
        />
      )}
    </svg>
  );
};

export const LossChart = memo(LossChartComponent);
