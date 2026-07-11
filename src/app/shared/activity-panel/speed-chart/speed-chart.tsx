import { memo, useMemo } from 'react';

import type { SpeedPoint } from '@/app/services/training/types';

import { formatSecPerIt, trimSettleSteps } from '../helpers';

type SpeedChartProps = {
  speedHistory: SpeedPoint[];
  /** Full run length — fixes the x-axis so the curve lines up with the loss graph above. */
  totalSteps: number;
  width: number;
  height: number;
  className?: string;
};

// Matches the loss chart's detail padding on the left/right so the two plots
// share an x-axis; a shorter top/bottom keeps this secondary graph compact.
const PADDING = { top: 8, right: 12, bottom: 8, left: 42 };

/**
 * Seconds-per-iteration over the course of a run — a small secondary graph
 * shown beneath the loss curve in the expanded training detail view. Its
 * x-axis is fixed to the full step range so it aligns with the loss chart;
 * the y-domain zooms to the observed speed band. Leading warmup iterations
 * (cold caches, lazy CUDA init) are trimmed so the first slow steps don't
 * squash the scale. Speed is a distinct indigo, kept clear of the loss
 * palette above.
 */
const SpeedChartComponent = ({
  speedHistory,
  totalSteps,
  width,
  height,
  className = '',
}: SpeedChartProps) => {
  const visible = useMemo(
    () => trimSettleSteps(speedHistory),
    [speedHistory],
  );

  const scale = useMemo(() => {
    const innerWidth = Math.max(1, width - PADDING.left - PADDING.right);
    const innerHeight = Math.max(1, height - PADDING.top - PADDING.bottom);

    const steps = visible.map((p) => p.step);
    const values = visible.map((p) => p.secPerIt);
    const maxObservedStep = steps.length > 0 ? Math.max(...steps) : 0;
    const xMax = totalSteps > 0 ? totalSteps : Math.max(1, maxObservedStep);

    // Zoom the y-domain to the observed band — s/it hovers in a narrow range,
    // so a zero baseline would flatten it. Pad a touch on each side.
    let lo = values.length > 0 ? Math.min(...values) : 0;
    let hi = values.length > 0 ? Math.max(...values) : 1;
    if (hi <= lo) {
      hi = lo > 0 ? lo * 1.1 : 1;
      lo = lo > 0 ? lo * 0.9 : 0;
    }
    const pad = (hi - lo) * 0.12;
    const yMin = Math.max(0, lo - pad);
    const yMax = hi + pad;

    const xScale = (step: number) =>
      PADDING.left + (Math.min(Math.max(step, 0), xMax) / xMax) * innerWidth;
    const yScale = (v: number) =>
      PADDING.top +
      (1 - (Math.min(Math.max(v, yMin), yMax) - yMin) / (yMax - yMin)) *
        innerHeight;

    const linePath =
      visible.length >= 2
        ? visible
            .map(
              (p, i) =>
                `${i === 0 ? 'M' : 'L'}${xScale(p.step)},${yScale(p.secPerIt)}`,
            )
            .join(' ')
        : null;

    return { xScale, yScale, yMin, yMax, linePath };
  }, [visible, totalSteps, width, height]);

  if (visible.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={`inline-block ${className}`}
      >
        <text
          x={width / 2}
          y={height / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-slate-400 text-xs"
        >
          No speed data yet
        </text>
      </svg>
    );
  }

  const { xScale, yScale, yMin, yMax, linePath } = scale;
  const lastPoint = visible[visible.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`inline-block ${className}`}
    >
      {/* Y gridlines + ticks (domain min / max only — this graph stays short) */}
      {[yMax, yMin].map((tick) => (
        <g key={tick}>
          <line
            x1={PADDING.left}
            x2={width - PADDING.right}
            y1={yScale(tick)}
            y2={yScale(tick)}
            strokeWidth={1}
            className="stroke-slate-200 dark:stroke-slate-700"
          />
          <text
            x={PADDING.left - 6}
            y={yScale(tick)}
            textAnchor="end"
            dominantBaseline="middle"
            className="fill-slate-400 text-[10px] tabular-nums"
          >
            {formatSecPerIt(tick)}
          </text>
        </g>
      ))}

      {linePath ? (
        <path
          d={linePath}
          fill="none"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="stroke-indigo-500"
        />
      ) : (
        <circle
          cx={xScale(lastPoint.step)}
          cy={yScale(lastPoint.secPerIt)}
          r={3}
          className="fill-indigo-500"
        />
      )}

      {linePath && (
        <circle
          cx={xScale(lastPoint.step)}
          cy={yScale(lastPoint.secPerIt)}
          r={4}
          strokeWidth={2}
          className="fill-indigo-500 stroke-slate-100 dark:stroke-slate-900"
        />
      )}
    </svg>
  );
};

export const SpeedChart = memo(SpeedChartComponent);
