import { useEffect, useRef } from 'react';

import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import {
  handleAssetClick,
  selectCurrentAssetId,
  setCurrentAsset,
} from '@/app/store/selection';

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
 * Find the cell visually above/below the current one: the horizontally
 * nearest cell in the closest row in that direction. Geometry-based rather
 * than index arithmetic so partial rows at category-group boundaries move to
 * the cell actually below, not a diagonal neighbour in display order.
 * Returns null at a dead end (no row further in that direction).
 */
const findVerticalNeighbour = (
  currentId: string,
  direction: 1 | -1,
): string | null => {
  const cells = collectCellPositions();
  const current = cells.find((cell) => cell.id === currentId);
  if (!current) return null;

  const candidates = cells.filter((cell) =>
    direction === 1
      ? cell.top > current.top + ROW_TOLERANCE
      : cell.top < current.top - ROW_TOLERANCE,
  );
  if (!candidates.length) return null;

  const nextRowTop =
    direction === 1
      ? Math.min(...candidates.map((cell) => cell.top))
      : Math.max(...candidates.map((cell) => cell.top));
  const row = candidates.filter(
    (cell) => Math.abs(cell.top - nextRowTop) <= ROW_TOLERANCE,
  );

  let best = row[0];
  for (const cell of row) {
    if (
      Math.abs(cell.centerX - current.centerX) <
      Math.abs(best.centerX - current.centerX)
    ) {
      best = cell;
    }
  }
  return best.id;
};

const scrollCellIntoView = (assetId: string) => {
  document
    .querySelector(`[data-asset-id="${CSS.escape(assetId)}"]`)
    ?.scrollIntoView({ block: 'nearest' });
};

/**
 * Keyboard navigation for the grid view's current asset.
 *
 * - Left/right step linearly through display order (crossing row and
 *   category boundaries); up/down move to the visually nearest cell in the
 *   adjacent row, measured from the rendered layout at keypress time so
 *   breakpoint reflows and partial category rows are always respected.
 * - Home/End jump to the first/last asset on the page.
 * - Space and Enter toggle selection of the current asset (with Shift they
 *   extend the range from the last click, same as shift-clicking it).
 * - Escape clears the current asset.
 *
 * Inert while focus is in an input-like element or any dialog is open, so it
 * never fights local keyboard handling.
 */
export const useGridKeyboardNav = (
  orderedAssetIds: string[],
  currentPage: number,
) => {
  const dispatch = useAppDispatch();
  const currentAssetId = useAppSelector(selectCurrentAssetId);

  // Refs so the window listener binds once and always sees fresh values
  const currentRef = useRef(currentAssetId);
  const idsRef = useRef(orderedAssetIds);

  useEffect(() => {
    currentRef.current = currentAssetId;
  }, [currentAssetId]);

  useEffect(() => {
    idsRef.current = orderedAssetIds;
  }, [orderedAssetIds]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return;
      }
      if (document.querySelector('[role="dialog"]')) return;

      // A control that genuinely holds focus (shelf button, view toggle,
      // a tabbed-to checkbox) keeps its native Enter/Space semantics; the
      // global bindings only act when nothing interactive is focused
      const interactiveFocus = !!target?.closest(
        'button, a, [role="button"], [role="checkbox"], [role="switch"]',
      );

      const ids = idsRef.current;
      if (!ids.length) return;

      const current = currentRef.current;
      const currentIndex = current ? ids.indexOf(current) : -1;

      let nextIndex: number | null = null;

      switch (e.key) {
        case 'ArrowRight':
          nextIndex =
            currentIndex === -1
              ? 0
              : Math.min(currentIndex + 1, ids.length - 1);
          break;
        case 'ArrowLeft':
          nextIndex = currentIndex === -1 ? 0 : Math.max(currentIndex - 1, 0);
          break;
        case 'ArrowDown':
        case 'ArrowUp': {
          if (currentIndex === -1 || !current) {
            nextIndex = 0;
            break;
          }
          const neighbourId = findVerticalNeighbour(
            current,
            e.key === 'ArrowDown' ? 1 : -1,
          );
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
          if (current) {
            dispatch(setCurrentAsset(null));
          }
          return;
        default:
          return;
      }

      if (nextIndex !== null) {
        e.preventDefault();
        const nextId = ids[nextIndex];
        dispatch(setCurrentAsset(nextId));
        scrollCellIntoView(nextId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dispatch, currentPage]);
};
