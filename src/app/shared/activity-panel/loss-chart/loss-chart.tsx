import { memo, useMemo } from 'react';

import type { LossPoint } from '@/app/services/training/types';

import { formatLoss, trimSettleSteps } from '../helpers';
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
// saved checkpoints violet, epoch boundaries light slate.

const LossChartComponent = ({
  lossHistory,
  totalSteps,
  currentStep,
  totalEpochs = 0,
  checkpointSteps = [],
  savedCheckpoints = [],
  lrCurve = null,
  variant = 'compact',
  width,
  height,
  className = '',
}: LossChartProps) => {
  const isDetail = variant === 'detail';
  const padding = isDetail ? DETAIL_PADDING : COMPACT_PADDING;

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
    paddingTop: padding.top,
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

  // Epoch boundaries as light gridlines, at the trainer's actual per-epoch
  // step (same ceil-based math as deriveCheckpointSteps), excluding the run's
  // end which is the plot's right edge. A boundary that lands on a drawn
  // checkpoint line is dropped — the checkpoint takes precedence, since in
  // epoch-save mode every save sits on an epoch boundary.
  const epochLineXs: number[] = [];
  if (totalEpochs >= 2 && xMax > 0) {
    const stepsPerEpoch = Math.max(1, Math.ceil(xMax / totalEpochs));
    const drawnCheckpointXs = [...upcomingCheckpoints, ...savedCheckpoints].map(
      (step) => xScale(step),
    );
    for (let e = 1; e < totalEpochs; e++) {
      const step = Math.min(e * stepsPerEpoch, xMax);
      const x = xScale(step);
      if (drawnCheckpointXs.some((cx) => Math.abs(cx - x) < 4)) continue;
      epochLineXs.push(x);
    }
  }

  const lineTop = padding.top;
  const lineBottom = height - padding.bottom;

  const lastPoint = visibleHistory[visibleHistory.length - 1];

  // LR schedule background: curve points spread across the full plot width,
  // normalised so peak LR touches the top edge. Rendered as a faint fill
  // with a slightly stronger top edge carrying the shape.
  const lrPoints =
    lrCurve && lrCurve.length >= 2
      ? lrCurve.map((v, i) => {
          const x = padding.left + (i / (lrCurve.length - 1)) * innerWidth;
          const y = padding.top + (1 - v) * innerHeight;
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

      {/* Epoch boundaries: light grey, dashed — sit behind the checkpoint
          lines, which take precedence where the two coincide. Rendered in
          both variants. */}
      {epochLineXs.map((x, i) => (
        <line
          key={`epoch-${i}`}
          x1={x}
          x2={x}
          y1={lineTop}
          y2={lineBottom}
          strokeWidth={1}
          strokeDasharray="2,3"
          className="stroke-slate-300/70 dark:stroke-slate-600/60"
        />
      ))}

      {/* Upcoming checkpoints: dashed, faded violet — same family as the
          solid saved-checkpoint lines, distinct from the grey epoch grid. */}
      {upcomingCheckpoints.map((step) => (
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

      {/* Confirmed checkpoint saves: solid */}
      {savedCheckpoints.map((step) => (
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
    </svg>
  );
};

export const LossChart = memo(LossChartComponent);
