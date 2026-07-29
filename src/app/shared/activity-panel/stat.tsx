import type { ReactNode } from 'react';

/**
 * A single labelled figure in a job detail view's stats grid. Renders nothing
 * for a null value, so callers can list every stat a job type might have and
 * let the absent ones fall away.
 *
 * `background` is painted edge to edge behind the text — used for the host
 * load sparklines. `tone` recolours the border to flag the figure itself
 * (heat, currently) without touching the number's own styling.
 */
export function Stat({
  label,
  value,
  background,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  background?: ReactNode;
  tone?: 'default' | 'warning';
}) {
  if (value == null) return null;
  return (
    <div
      className={`relative overflow-hidden rounded border px-2.5 py-1.5 text-shadow-2xs text-shadow-white dark:text-shadow-slate-900 ${
        tone === 'warning'
          ? 'border-amber-500 bg-amber-50 dark:border-amber-500/70 dark:bg-amber-950/20'
          : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60'
      }`}
    >
      {background && (
        <div className="pointer-events-none absolute inset-0">{background}</div>
      )}
      <div className="relative text-xs text-slate-400 uppercase">{label}</div>
      <div className="relative mt-0.5 text-sm font-medium text-(--foreground) tabular-nums">
        {value}
      </div>
    </div>
  );
}
