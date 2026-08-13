import { useEffect, useRef } from 'react';

import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import {
  handleAssetClick,
  selectCurrentAssetId,
  setCurrentAsset,
  setShiftHoverAssetId,
} from '@/app/store/selection';

/** The per-view half of the keyboard model: where Tab lands and what extra
 * layers Escape unwinds. Everything else is identical across views. */
export type AssetNavAdapter = {
  /** Nav is inert while focus is inside this surface (the view's editing UI
   * owns its own keys). */
  editorSelector: string;
  /** Bring the current asset's editing surface under the keyboard. */
  onTabInto: (currentAssetId: string) => void;
  /** Unwind a view-specific layer (e.g. an overlay). Return true when a
   * layer was closed, so the current asset survives this Escape. */
  onEscape?: () => boolean;
};

type CellPosition = {
  id: string;
  top: number;
  centerX: number;
};

// Cells within this many pixels of each other's top edge count as one visual row
const ROW_TOLERANCE = 4;

const collectCellPositions = (): CellPosition[] =>
  Array.from(
    document.querySelectorAll<HTMLElement>('[data-asset-id]'),
  ).map((el) => {
    const rect = el.getBoundingClientRect();
    return {
      id: el.dataset.assetId ?? '',
      top: rect.top,
      centerX: rect.left + rect.width / 2,
    };
  });

/**
 * The visual rows strictly above/below the current cell, nearest row first.
 * Geometry-based rather than index arithmetic so partial rows at
 * category-group boundaries move to the cell actually below, not a diagonal
 * neighbour in display order. (For the list view's full-width rows every row
 * is its own visual row, so a row is always a single cell.)
 */
const rowsBeyond = (
  cells: CellPosition[],
  current: CellPosition,
  direction: 1 | -1,
): CellPosition[][] => {
  const candidates = cells
    .filter((cell) =>
      direction === 1
        ? cell.top > current.top + ROW_TOLERANCE
        : cell.top < current.top - ROW_TOLERANCE,
    )
    .sort((a, b) => (a.top - b.top) * direction);

  const rows: CellPosition[][] = [];
  for (const cell of candidates) {
    const row = rows.at(-1);
    if (row && Math.abs(row[0].top - cell.top) <= ROW_TOLERANCE) {
      row.push(cell);
    } else {
      rows.push([cell]);
    }
  }
  return rows;
};

/** The cell in `row` horizontally nearest the current one, so vertical moves
 * hold their column across ragged rows. */
const nearestInRow = (row: CellPosition[], current: CellPosition) =>
  row.reduce((best, cell) =>
    Math.abs(cell.centerX - current.centerX) <
    Math.abs(best.centerX - current.centerX)
      ? cell
      : best,
  );

/** Height of the gallery between the two fixed shelves — how far one
 * PageUp/PageDown moves. */
const visibleGalleryHeight = (): number => {
  const shelfBottom =
    document.querySelector('[data-top-shelf]')?.getBoundingClientRect()
      .bottom ?? 0;
  const bottomShelfTop =
    document.querySelector('[data-bottom-shelf]')?.getBoundingClientRect()
      .top ?? window.innerHeight;
  return Math.max(bottomShelfTop - shelfBottom, 1);
};

/**
 * Find the cell visually above/below the current one. Returns null at a dead
 * end (no row further in that direction).
 */
const findVerticalNeighbour = (
  currentId: string,
  direction: 1 | -1,
): string | null => {
  const cells = collectCellPositions();
  const current = cells.find((cell) => cell.id === currentId);
  if (!current) return null;

  const [row] = rowsBeyond(cells, current, direction);
  return row ? nearestInRow(row, current).id : null;
};

/**
 * Find the cell one screenful above/below the current one: the furthest row
 * still within a gallery height, so a page step never skips past assets you
 * haven't seen. Falls back to the adjacent row when a single row is taller
 * than the viewport, and returns null at a dead end.
 */
const findPageNeighbour = (
  currentId: string,
  direction: 1 | -1,
): string | null => {
  const cells = collectCellPositions();
  const current = cells.find((cell) => cell.id === currentId);
  if (!current) return null;

  const rows = rowsBeyond(cells, current, direction);
  if (!rows.length) return null;

  const span = visibleGalleryHeight();
  let target = rows[0];
  for (const row of rows) {
    if (Math.abs(row[0].top - current.top) > span) break;
    target = row;
  }
  return nearestInRow(target, current).id;
};

export const scrollAssetIntoView = (assetId: string) => {
  document
    .querySelector(`[data-asset-id="${CSS.escape(assetId)}"]`)
    ?.scrollIntoView({ block: 'nearest' });
};

/**
 * The first asset whose top edge clears the fixed top shelf — where arrow
 * keys pick up when nothing is highlighted yet, so starting navigation
 * mid-scroll works on what's in front of you instead of yanking the view
 * back to the first asset on the page. Falls back to null when everything
 * on screen is partially scrolled off (caller uses display-order first).
 */
const findFirstFullyVisibleId = (): string | null => {
  const shelfBottom =
    document.querySelector('[data-top-shelf]')?.getBoundingClientRect()
      .bottom ?? 0;
  for (const el of document.querySelectorAll<HTMLElement>('[data-asset-id]')) {
    if (el.getBoundingClientRect().top >= shelfBottom) {
      return el.dataset.assetId ?? null;
    }
  }
  return null;
};

// Both views' editing surfaces; only one exists at a time, so hotkeys that
// aren't view-specific guard against the pair
export const GALLERY_EDITOR_SELECTOR =
  '[data-grid-inspector], [data-asset-editor]';

/**
 * True when a keystroke belongs to a typing (or otherwise key-consuming)
 * widget: a text input, a focused video player's transport keys, or an open
 * dialog. The floor every gallery hotkey guards against.
 */
export const isTypingContextBlocked = (e: KeyboardEvent): boolean => {
  if (e.defaultPrevented) return true;
  const target = e.target as HTMLElement | null;
  if (
    target?.closest('input, textarea, select, video, [contenteditable="true"]')
  ) {
    return true;
  }
  return !!document.querySelector('[role="dialog"]');
};

/**
 * True when a global asset hotkey must stay inert: a typing context, or
 * focus inside the view's editing surface (whose widgets own the same
 * arrows/Enter/Space/Escape the nav layer binds). Shared by the nav layer
 * and the sibling asset hotkeys so "when the keyboard belongs to the
 * gallery" has exactly one definition.
 */
export const isNavContextBlocked = (
  e: KeyboardEvent,
  editorSelector: string,
): boolean => {
  if (isTypingContextBlocked(e)) return true;
  const target = e.target as HTMLElement | null;
  return !!target?.closest(editorSelector);
};

/**
 * Keyboard navigation for the gallery's current asset, shared by the grid
 * and list views (per-view differences live in the adapter).
 *
 * - Left/right step linearly through display order (crossing row and
 *   category boundaries); up/down move to the visually nearest cell in the
 *   adjacent row, measured from the rendered layout at keypress time so
 *   breakpoint reflows and partial category rows are always respected.
 * - PageUp/PageDown move a screenful in the same geometric terms, landing on
 *   the furthest row still within one gallery height (native page scrolling
 *   is suppressed — the highlight scrolls itself into view instead).
 * - Home/End jump to the first/last asset on the page.
 * - Space and Enter toggle selection of the current asset (with Shift they
 *   extend the range from the last click, same as shift-clicking it).
 * - Escape unwinds one layer at a time: the adapter's layer first (the
 *   grid's narrow-viewport overlay), then the current-asset highlight.
 * - Tab (with a current asset, no control focused) crosses into the view's
 *   editing surface via the adapter — the grid's inspector panel or the list
 *   row's inline editor; Escape from there crosses back (handleEditorEscape).
 *   Shift+Tab and Tab from a focused control stay native.
 *
 * Inert while focus is in an input-like element or the editing surface, or
 * while any dialog is open, so it never fights local keyboard handling.
 */
export const useAssetKeyboardNav = (
  orderedAssetIds: string[],
  currentPage: number,
  adapter: AssetNavAdapter,
) => {
  const dispatch = useAppDispatch();
  const currentAssetId = useAppSelector(selectCurrentAssetId);

  // Refs so the window listener binds once and always sees fresh values
  const currentRef = useRef(currentAssetId);
  const idsRef = useRef(orderedAssetIds);
  const adapterRef = useRef(adapter);

  useEffect(() => {
    currentRef.current = currentAssetId;
  }, [currentAssetId]);

  useEffect(() => {
    idsRef.current = orderedAssetIds;
  }, [orderedAssetIds]);

  useEffect(() => {
    adapterRef.current = adapter;
  }, [adapter]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const { editorSelector, onTabInto, onEscape } = adapterRef.current;
      if (isNavContextBlocked(e, editorSelector)) return;

      // A control that genuinely holds focus (shelf button, view toggle,
      // a tabbed-to checkbox) keeps its native Enter/Space semantics; the
      // global bindings only act when nothing interactive is focused
      const target = e.target as HTMLElement | null;
      const interactiveFocus = !!target?.closest(
        'button, a, [role="button"], [role="checkbox"], [role="switch"]',
      );

      const ids = idsRef.current;
      if (!ids.length) return;

      const current = currentRef.current;
      const currentIndex = current ? ids.indexOf(current) : -1;

      // With no highlight yet, arrows pick up from the first asset actually
      // in view rather than jumping the page back to the top
      const pickupIndex = () => {
        const visibleId = findFirstFullyVisibleId();
        const index = visibleId ? ids.indexOf(visibleId) : -1;
        return index === -1 ? 0 : index;
      };

      let nextIndex: number | null = null;

      switch (e.key) {
        case 'ArrowRight':
          nextIndex =
            currentIndex === -1
              ? pickupIndex()
              : Math.min(currentIndex + 1, ids.length - 1);
          break;
        case 'ArrowLeft':
          nextIndex =
            currentIndex === -1
              ? pickupIndex()
              : Math.max(currentIndex - 1, 0);
          break;
        case 'ArrowDown':
        case 'ArrowUp':
        case 'PageDown':
        case 'PageUp': {
          if (currentIndex === -1 || !current) {
            nextIndex = pickupIndex();
            break;
          }
          const byPage = e.key === 'PageDown' || e.key === 'PageUp';
          const neighbourId = (
            byPage ? findPageNeighbour : findVerticalNeighbour
          )(current, e.key === 'ArrowDown' || e.key === 'PageDown' ? 1 : -1);
          // Dead end: no row further in that direction
          if (neighbourId === null) return;
          nextIndex = ids.indexOf(neighbourId);
          if (nextIndex === -1) return;
          break;
        }
        case 'Home':
          nextIndex = 0;
          break;
        case 'End':
          nextIndex = ids.length - 1;
          break;
        case ' ':
        case 'Enter':
          if (interactiveFocus) return; // let the focused control handle it
          if (current) {
            e.preventDefault();
            dispatch(
              handleAssetClick({
                assetId: current,
                isShiftHeld: e.shiftKey,
                currentPage,
              }),
            );
          }
          return;
        case 'Escape':
          // Back out one layer at a time: the view's layer first, then the
          // highlight
          if (onEscape?.()) return;
          if (current) {
            dispatch(setCurrentAsset(null));
          }
          return;
        case 'Tab':
          // Bridge to the editing surface so tagging the current asset is
          // one keystroke away; from a focused control, Tab keeps native
          // order
          if (e.shiftKey || interactiveFocus || !current) return;
          e.preventDefault();
          onTabInto(current);
          return;
        default:
          return;
      }

      if (nextIndex !== null) {
        e.preventDefault();
        // Keyboard navigation reclaims the gallery: drop focus from whatever
        // control Tab wandered onto (shelf buttons etc.), so the next Tab
        // bridges to the editing surface rather than resuming shelf tab order
        (document.activeElement as HTMLElement | null)?.blur();
        const nextId = ids[nextIndex];
        dispatch(setCurrentAsset(nextId));
        // Moving with Shift held previews the range a Shift+Space would
        // select, exactly as shift-hovering the same asset with the mouse
        if (e.shiftKey) {
          dispatch(setShiftHoverAssetId(nextId));
        }
        scrollAssetIntoView(nextId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dispatch, currentPage]);
};
