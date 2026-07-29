import { memo } from 'react';

import { HISTORY_WINDOW_MS, type SeriesPoint } from './history';

type StatSparklineProps = {
  /** The headline figure, drawn as a line. Values are percentages. */
  line: SeriesPoint[];
  /** A secondary figure drawn as a faint fill behind it — memory, typically. */
  area?: SeriesPoint[];
  /** Right edge of the time axis; pass the newest sample's timestamp. */
  now: number;
};

// One hue for every host card. These graphs are a texture, not a comparison —
// two colours would imply a distinction between CPU and GPU load that isn't
// there. The line and the fill are told apart by weight, and by the key dots
// sitting against the figures they belong to.
const LINE = 'stroke-sky-500 opacity-50';
const AREA = 'fill-sky-500 opacity-10';

/**
 * The key for `StatSparkline`, sat at the head of the figure it stands for:
 * a solid dot for the line, a faint one for the fill behind it. Ringed so it
 * still reads as a distinct mark where the graph passes underneath.
 */
export function SparklineDot({ variant }: { variant: 'line' | 'area' }) {
  return (
    <span
      aria-hidden
      className={`h-1.5 w-1.5 shrink-0 self-center rounded-full ring-1 ring-sky-700/50 dark:ring-sky-200/40 ${
        variant === 'line' ? 'bg-sky-500' : 'bg-sky-500/30'
      }`}
    />
  );
}

// The plot is drawn in a 100x100 box and stretched to the card by
// `preserveAspectRatio="none"`, so these are percentages of the card, not px.
// A little headroom top and bottom keeps a pegged 100% or an idle 0% from
// sitting flush against the border.
const TOP = 8;
const BOTTOM = 94;

// A missed poll or two is normal; a longer silence (modal closed, sidecar
// restarted) is a real gap and gets a break in the line rather than a
// straight run across dead time.
const GAP_MS = 15_000;

const clamp = (v: number) => Math.min(100, Math.max(0, v));

/** Split on time gaps so each contiguous run of samples draws as its own path. */
const toSegments = (points: SeriesPoint[]) => {
  const segments: SeriesPoint[][] = [];
  points.forEach((point, i) => {
    const previous = points[i - 1];
    if (!previous || point.t - previous.t > GAP_MS) segments.push([point]);
    else segments[segments.length - 1].push(point);
  });
  return segments;
};

/**
 * The rolling load graph that sits behind a host stat card's figures.
 *
 * Tertiary information by design — it answers "has this been steady, or is it
 * sawtoothing / creeping up" at a glance, and is never meant to be read off
 * precisely. Hence no axes, no gridlines and a low opacity: the numbers in
 * front stay the thing you actually read. Time runs left (older) to right
 * (now); before the window fills the line simply hugs the right edge.
 *
 * Nothing here is persisted — see `history.ts`.
 */
const StatSparklineComponent = ({ line, area, now }: StatSparklineProps) => {
  if (line.length < 2 && (area?.length ?? 0) < 2) return null;

  const x = (t: number) => 100 - ((now - t) / HISTORY_WINDOW_MS) * 100;
  const y = (value: number) => TOP + (1 - clamp(value) / 100) * (BOTTOM - TOP);

  const toLinePath = (points: SeriesPoint[]) =>
    points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t)},${y(p.value)}`)
      .join(' ');

  // Areas close down to the baseline; single-sample segments would draw a
  // zero-width sliver, so they're dropped.
  const areaSegments = toSegments(area ?? []).filter((s) => s.length >= 2);
  const lineSegments = toSegments(line).filter((s) => s.length >= 2);

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="h-full w-full"
      aria-hidden
    >
      {areaSegments.map((segment) => (
        <path
          key={`a${segment[0].t}`}
          d={`${toLinePath(segment)} L${x(segment[segment.length - 1].t)},100 L${x(segment[0].t)},100 Z`}
          className={AREA}
        />
      ))}
      {lineSegments.map((segment) => (
        <path
          key={`l${segment[0].t}`}
          d={toLinePath(segment)}
          fill="none"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          // Without this the non-uniform stretch would thin the horizontal
          // runs and fatten the vertical ones.
          vectorEffect="non-scaling-stroke"
          className={LINE}
        />
      ))}
    </svg>
  );
};

export const StatSparkline = memo(StatSparklineComponent);
