import type { SampleProgress } from '@/app/services/training/types';
import { ProgressBar } from '@/app/shared/progress-bar/progress-bar';

import { SampleImg } from '../sample-img/sample-img';
import {
  type SampleColumn,
  type SampleRow,
  type SamplesGridModel,
} from '../training-detail-tabs/samples-model';

type SamplesGridProps = {
  grid: SamplesGridModel;
  onOpen: (rowKey: string, colIndex: number, trigger: HTMLElement) => void;
};

/**
 * The samples grid: prompt columns across the top, sampling events down the
 * side (newest first). A CSS grid rather than a table so every prompt column
 * gets an identical share of the width (equal `1fr` tracks with a floor),
 * scrolling horizontally when they'd otherwise be crushed. Rows use
 * `display: contents` so their cells participate in the one grid while the
 * markup keeps its row grouping. Thumbnails are the served images scaled by
 * CSS — no thumbnail generation.
 */
export function SamplesGrid({ grid, onOpen }: SamplesGridProps) {
  const { columns, rows } = grid;

  return (
    <div className="overflow-x-auto">
      <div
        role="table"
        className="grid gap-2"
        // Label column hugs its widest stamp; prompt columns share the rest
        // evenly, never dropping below 10rem — past that the container scrolls.
        style={{
          gridTemplateColumns: `auto repeat(${columns.length}, minmax(10rem, 1fr))`,
        }}
      >
        <div role="row" className="contents">
          {/* Corner cell above the row-stamp column. */}
          <div role="columnheader" aria-label="Sampling event" />
          {columns.map((column) => (
            <ColumnHeader key={column.index} column={column} />
          ))}
        </div>
        {rows.map((row) => (
          <GridRow key={row.key} row={row} columns={columns} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

function ColumnHeader({ column }: { column: SampleColumn }) {
  return (
    // min-w-0 stops a long unbreakable prompt widening its track past 1fr.
    <div role="columnheader" className="min-w-0 self-end">
      <span
        title={column.label}
        className="block truncate px-2 text-xs font-medium text-slate-600 dark:text-slate-300"
      >
        {column.label}
      </span>
    </div>
  );
}

/**
 * The cell the trainer is rendering into right now. Determinate when the
 * backend reports the sampler's diffusion steps (Kohya), indeterminate
 * otherwise (ai-toolkit reports only the image count within the event), so the
 * cell always reads as "working" rather than as an empty slot.
 */
function GeneratingCell({
  progress,
  label,
}: {
  progress: SampleProgress | null;
  label: string;
}) {
  const determinate = progress != null && progress.total > 0;
  return (
    <div
      className="flex h-28 w-full flex-col items-center justify-center gap-2 rounded border border-dashed border-violet-400 px-3 pt-4.5 dark:border-violet-500/70"
      title={`Generating ${label}`}
    >
      {determinate ? (
        <ProgressBar
          value={progress.current}
          max={progress.total}
          size="xs"
          color="indigo"
        />
      ) : (
        <ProgressBar size="xs" color="indigo" indeterminate />
      )}
      <span className="text-xs text-violet-600 tabular-nums dark:text-violet-400">
        {determinate
          ? `Step ${progress.current}/${progress.total}`
          : 'Generating...'}
      </span>
    </div>
  );
}

function GridRow({
  row,
  columns,
  onOpen,
}: {
  row: SampleRow;
  columns: SampleColumn[];
  onOpen: (rowKey: string, colIndex: number, trigger: HTMLElement) => void;
}) {
  return (
    <div role="row" className="contents">
      <div
        role="rowheader"
        className={`flex items-end justify-center text-right text-sm font-medium whitespace-nowrap [writing-mode:sideways-lr] ${
          row.upcoming ? 'text-slate-400' : 'text-slate-500'
        }`}
      >
        {row.label ?? '—'}
      </div>

      {columns.map((column) => {
        const sample = row.cells[column.index];
        return (
          <div key={column.index} role="cell" className="min-w-0 self-center">
            {sample ? (
              <button
                type="button"
                onClick={(e) => onOpen(row.key, column.index, e.currentTarget)}
                title={`${row.label} · ${column.label}`}
                aria-label={`Open sample for ${column.label} at ${row.label}`}
                className="block w-full cursor-pointer overflow-hidden rounded border border-slate-300 bg-slate-100 transition-colors hover:border-sky-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-600 dark:bg-slate-900"
              >
                <SampleImg
                  key={sample.path}
                  path={sample.path}
                  alt={`${column.label} — ${row.label}`}
                  loading="lazy"
                  className="h-28 w-full object-contain"
                />
              </button>
            ) : column.index === row.generatingIndex ? (
              <GeneratingCell
                progress={row.generatingProgress ?? null}
                label={column.label}
              />
            ) : (
              <div className="flex h-28 w-full items-center justify-center rounded border border-dashed border-slate-200 text-xs text-slate-400 dark:border-slate-700">
                —
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
