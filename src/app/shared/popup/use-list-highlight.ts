'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';

import { scrollOptionIntoView } from './scroll-option-into-view';

/**
 * Shared keyboard-navigation and highlight state for popup lists
 * (dropdowns, menus, etc.).
 *
 * Keeps focus on the trigger element and tracks the highlighted index via
 * `aria-activedescendant`, following the ARIA combobox/listbox pattern.
 *
 * Features:
 * - Two-layer highlight: keyboard anchor + mouse hover override
 * - Arrow/Home/End/Tab navigation (skipping non-navigable indices)
 * - Enter/Space to confirm, Escape to close
 * - Scroll-into-view with adjacent-item peek for the keyboard highlight
 * - Option ID generation for aria-activedescendant
 * - onPositioned callback to highlight an initial item after the popup opens
 */

interface UseListHighlightOptions {
  /** Total number of entries (including non-navigable ones like group headers). */
  count: number;
  /**
   * Returns true if the entry at `index` can be highlighted.
   * Return false for group headers, disabled items, etc.
   */
  isNavigable: (index: number) => boolean;
  /** Whether the popup is currently open (for scroll-into-view). */
  isOpen: boolean;
  /** Called when the user confirms the highlighted item (Enter/Space). */
  onSelect: (index: number) => void;
  /** Called to close the popup (Escape/Tab). */
  onClose: () => void;
  /**
   * Preferred initial index when the popup opens (e.g. the selected item).
   * Falls back to the first navigable item if this index is not navigable.
   * Defaults to -1 (first navigable item).
   */
  initialIndex?: number;
}

/** Find the next navigable index in the given direction, or -1. */
function findNext(
  count: number,
  isNavigable: (i: number) => boolean,
  from: number,
  direction: 1 | -1,
): number {
  let i = from;
  while (i >= 0 && i < count) {
    if (isNavigable(i)) return i;
    i += direction;
  }
  return -1;
}

export function useListHighlight({
  count,
  isNavigable,
  isOpen,
  onSelect,
  onClose,
  initialIndex = -1,
}: UseListHighlightOptions) {
  const idPrefix = useId();

  // Two-layer highlight: keyboard is the anchor, mouse overrides while hovering.
  // keyboardActive tracks whether the user has actually pressed arrow keys —
  // the keyboard index is seeded to the selected item on open (so arrows start
  // from the right place), but we only visually highlight it after KB nav occurs.
  const [keyboardIndex, setKeyboardIndex] = useState(-1);
  const [hoverIndex, setHoverIndex] = useState(-1);
  const [keyboardActive, setKeyboardActive] = useState(false);
  const highlightedIndex =
    hoverIndex >= 0 ? hoverIndex : keyboardActive ? keyboardIndex : -1;

  /** Get the DOM id for an option at `index` (for aria-activedescendant). */
  const getOptionId = useCallback(
    (index: number) => `${idPrefix}-option-${index}`,
    [idPrefix],
  );

  /** The aria-activedescendant value for the trigger element. */
  const activeDescendant = useMemo(
    () => (highlightedIndex >= 0 ? getOptionId(highlightedIndex) : undefined),
    [highlightedIndex, getOptionId],
  );

  /** Reset highlight state (call when closing the popup). */
  const resetHighlight = useCallback(() => {
    setKeyboardIndex(-1);
    setHoverIndex(-1);
    setKeyboardActive(false);
  }, []);

  /**
   * Popup onPositioned callback — highlights the initial item after the popup
   * finishes its positioning phase. Called by Popup after its own double-rAF,
   * so no additional frame delay is needed here.
   */
  const handlePositioned = useCallback(() => {
    setKeyboardActive(false);
    setHoverIndex(-1);
    const start =
      initialIndex >= 0 && isNavigable(initialIndex)
        ? initialIndex
        : findNext(count, isNavigable, 0, 1);
    setKeyboardIndex(start >= 0 ? start : -1);
  }, [initialIndex, count, isNavigable]);

  /**
   * Keyboard handler for the open list. Call this from the trigger's onKeyDown
   * when the popup is open.
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'Enter':
        case ' ':
          if (highlightedIndex >= 0) onSelect(highlightedIndex);
          e.preventDefault();
          break;
        case 'Escape':
          onClose();
          e.preventDefault();
          break;
        case 'ArrowDown': {
          // When KB nav starts from no active highlight, begin from the
          // seeded keyboard index (selected item) rather than -1.
          const base = keyboardActive ? highlightedIndex : keyboardIndex;
          const next = findNext(count, isNavigable, base + 1, 1);
          if (next >= 0) {
            setKeyboardIndex(next);
            setHoverIndex(-1);
            setKeyboardActive(true);
          }
          e.preventDefault();
          break;
        }
        case 'ArrowUp': {
          const base = keyboardActive ? highlightedIndex : keyboardIndex;
          const prev = findNext(count, isNavigable, base - 1, -1);
          if (prev >= 0) {
            setKeyboardIndex(prev);
            setHoverIndex(-1);
            setKeyboardActive(true);
          }
          e.preventDefault();
          break;
        }
        case 'Home': {
          const first = findNext(count, isNavigable, 0, 1);
          if (first >= 0) {
            setKeyboardIndex(first);
            setHoverIndex(-1);
            setKeyboardActive(true);
          }
          e.preventDefault();
          break;
        }
        case 'End': {
          const last = findNext(count, isNavigable, count - 1, -1);
          if (last >= 0) {
            setKeyboardIndex(last);
            setHoverIndex(-1);
            setKeyboardActive(true);
          }
          e.preventDefault();
          break;
        }
        case 'Tab':
          onClose();
          break;
      }
    },
    [
      count,
      isNavigable,
      highlightedIndex,
      keyboardActive,
      keyboardIndex,
      onSelect,
      onClose,
    ],
  );

  /** Props to spread on each item element for hover tracking. */
  const getItemHoverProps = useCallback(
    (index: number) => ({
      onMouseMove: () => setHoverIndex(index),
      onMouseLeave: () => setHoverIndex(-1),
    }),
    [],
  );

  // Scroll the highlighted item into view when navigating by keyboard, with a
  // peek of the adjacent item so a scrollable list visibly continues. Gated on
  // hover being inactive — hover-driven scrolling would move the list under
  // the cursor.
  useEffect(() => {
    if (!isOpen || hoverIndex >= 0 || !keyboardActive || keyboardIndex < 0) {
      return;
    }
    const el = document.getElementById(getOptionId(keyboardIndex));
    if (!el) return;
    scrollOptionIntoView(el, {
      isFirst: keyboardIndex === findNext(count, isNavigable, 0, 1),
      isLast: keyboardIndex === findNext(count, isNavigable, count - 1, -1),
    });
  }, [
    isOpen,
    hoverIndex,
    keyboardActive,
    keyboardIndex,
    getOptionId,
    count,
    isNavigable,
  ]);

  return {
    highlightedIndex,
    getOptionId,
    activeDescendant,
    resetHighlight,
    handlePositioned,
    handleKeyDown,
    getItemHoverProps,
  };
}
