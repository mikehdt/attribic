import { useCallback, useMemo, useRef, useState } from 'react';

import type { TrainingJob } from '@/app/store/jobs';

import { deriveSecPerStep, formatEta } from '../../helpers';
import {
  buildSamplesGrid,
  type SampleRow,
  showsSamplesView,
} from './samples-model';

export type DetailTab = 'overview' | 'samples';

/**
 * Which cell the lightbox is showing, keyed by the sampling event's stable key
 * (`e{epoch}`/`s{step}`, from {@link buildSamplesGrid}) rather than its row
 * index. Rows sort newest-first, so a new event arriving over the WS prepends a
 * row and shifts every index down one; keying by the event lets an open
 * lightbox stay on exactly the same sample as the grid reflows. Columns only
 * ever append, so the column index is already stable.
 */
type LightboxSelection = { rowKey: string; colIndex: number };

/**
 * Tab + lightbox state for the training detail view. Shared by the live
 * activity-panel modal and the run-history modal so both get the same tabbed
 * treatment from one place. The grid model is derived from the passed job
 * (live progress or an archived snapshot — identical shape).
 */
export function useTrainingDetailTabs(job: TrainingJob | null) {
  const grid = useMemo(() => buildSamplesGrid(job), [job]);

  // Show the tab as soon as sampling is configured on a live run — an empty
  // frame with the prompt columns is the confirmation that the setting took.
  // Terminal runs only keep the tab when there's something to look at. The
  // host modals key their width off the same predicate.
  const showSamplesTab = showsSamplesView(job, grid);

  // Placeholder row for the next predicted sampling event, prepended above the
  // newest real row while training runs. All-null cells render as dashed
  // placeholders; the ETA rides under the label. Skipped while preparing —
  // the step counters belong to the setup phase then, not training — and while
  // the newest row is still filling in (samples land one prompt at a time, and
  // announcing the event after next mid-event reads as a spurious new row).
  const upcomingRow = useMemo<SampleRow | null>(() => {
    const progress = job?.progress ?? null;
    if (!progress || progress.status !== 'training') return null;
    const newest = grid.rows[0];
    if (newest && newest.cells.some((cell) => cell === null)) return null;
    const next = (progress.sampleSteps ?? []).find(
      (s) => s > progress.currentStep,
    );
    if (next == null) return null;
    const secPerStep = deriveSecPerStep(progress);
    const eta =
      secPerStep !== null
        ? formatEta(Math.round((next - progress.currentStep) * secPerStep))
        : null;
    return {
      key: 'upcoming',
      label: 'Next',
      sublabel: eta ? `~${eta}` : undefined,
      isEpoch: false,
      upcoming: true,
      cells: grid.columns.map(() => null),
    };
  }, [job, grid]);

  const displayGrid = useMemo(
    () =>
      upcomingRow
        ? { columns: grid.columns, rows: [upcomingRow, ...grid.rows] }
        : grid,
    [grid, upcomingRow],
  );

  // Callers key this hook's component by job id, so tab/lightbox state resets
  // per run; within a run it survives live progress updates. When a run has no
  // samples the tabbed shell isn't rendered at all, so 'overview' just idles.
  const [tab, setTab] = useState<DetailTab>('overview');
  const [lightbox, setLightbox] = useState<LightboxSelection | null>(null);

  // The grid button that opened the lightbox, so focus can return to it on
  // close (the button stays mounted behind the overlay — stable React keys keep
  // the same DOM node across live updates).
  const triggerRef = useRef<HTMLElement | null>(null);

  const openLightbox = useCallback(
    (rowKey: string, colIndex: number, trigger?: HTMLElement | null) => {
      triggerRef.current = trigger ?? null;
      setLightbox({ rowKey, colIndex });
    },
    [],
  );

  const closeLightbox = useCallback(() => {
    setLightbox(null);
    const trigger = triggerRef.current;
    triggerRef.current = null;
    // Return focus to the opener so keyboard control survives the overlay
    // unmounting (otherwise focus falls to <body> and goes dead).
    if (trigger && document.contains(trigger)) trigger.focus();
  }, []);

  // Step through rows (Up/Down — same prompt over time) or columns (Left/Right —
  // prompts at one event), skipping empty cells so mid-generation gaps don't
  // strand navigation. Stays put when there's nothing further in that direction.
  const move = useCallback(
    (axis: 'row' | 'col', delta: 1 | -1) => {
      setLightbox((pos) => {
        if (!pos) return pos;
        const { rows } = grid;
        const rowIndex = rows.findIndex((r) => r.key === pos.rowKey);
        if (rowIndex < 0) return pos; // Row gone; the render guard hides it.
        const { colIndex } = pos;

        if (axis === 'row') {
          for (let r = rowIndex + delta; r >= 0 && r < rows.length; r += delta) {
            if (rows[r].cells[colIndex]) {
              return { rowKey: rows[r].key, colIndex };
            }
          }
        } else {
          const cells = rows[rowIndex].cells;
          for (let c = colIndex + delta; c >= 0 && c < cells.length; c += delta) {
            if (cells[c]) return { rowKey: pos.rowKey, colIndex: c };
          }
        }
        return pos;
      });
    },
    [grid],
  );

  // Resolve the keyed selection to live array positions every render, so a grid
  // reflow moves the lightbox with its sample. A selection whose row has
  // vanished resolves to null and the tabbed shell simply stops rendering the
  // overlay — a graceful close.
  const activeRow = lightbox
    ? (grid.rows.find((r) => r.key === lightbox.rowKey) ?? null)
    : null;
  const activeColumn = lightbox
    ? (grid.columns[lightbox.colIndex] ?? null)
    : null;
  const activeSample =
    activeRow && lightbox ? (activeRow.cells[lightbox.colIndex] ?? null) : null;

  // Which directions actually have a reachable cell, mirroring `move`'s
  // skip-empty scan — drives the disabled/dimmed state of the nav chevrons.
  const nav = useMemo(() => {
    if (!lightbox) return null;
    const rows = grid.rows;
    const rowIndex = rows.findIndex((r) => r.key === lightbox.rowKey);
    if (rowIndex < 0) return null;
    const { colIndex } = lightbox;
    const scanRows = (delta: 1 | -1) => {
      for (let r = rowIndex + delta; r >= 0 && r < rows.length; r += delta) {
        if (rows[r].cells[colIndex]) return true;
      }
      return false;
    };
    const cells = rows[rowIndex].cells;
    const scanCols = (delta: 1 | -1) => {
      for (let c = colIndex + delta; c >= 0 && c < cells.length; c += delta) {
        if (cells[c]) return true;
      }
      return false;
    };
    return {
      up: scanRows(-1),
      down: scanRows(1),
      left: scanCols(-1),
      right: scanCols(1),
    };
  }, [grid, lightbox]);

  return {
    grid: displayGrid,
    showSamplesTab,
    hasRows: grid.rows.length > 0,
    tab,
    setTab,
    lightbox,
    openLightbox,
    closeLightbox,
    move,
    nav,
    activeRow,
    activeColumn,
    activeSample,
  };
}
