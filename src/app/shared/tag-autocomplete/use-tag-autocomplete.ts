'use client';

import {
  RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { usePopup } from '../popup';
import { scrollOptionIntoView } from '../popup/scroll-option-into-view';
import {
  DEFAULT_SUGGESTION_LIMIT,
  type TagSuggestion,
  useTagSuggestions,
} from './use-tag-suggestions';

type UseTagAutocompleteOptions = {
  /** The input's current text, matched against project tags */
  query: string;
  /** Tags to exclude from suggestions (e.g. tags already on the asset) */
  exclude?: string[];
  /**
   * Called when a suggestion is chosen (Enter/Tab/click). The host commits the
   * tag and is expected to update `query` (clear or replace it), which closes
   * the list. `shiftKey` carries the modifier for prepend-style flows.
   */
  onSelect: (tag: string, shiftKey: boolean) => void;
  /** Element the floating list anchors to — usually the input itself */
  anchorRef: RefObject<HTMLElement | null>;
  enabled?: boolean;
  limit?: number;
};

/** Everything TagAutocomplete needs to render the floating list. */
export type TagAutocompleteControl = {
  popupId: string;
  listboxId: string;
  anchorRef: RefObject<HTMLElement | null>;
  anchorWidth: number;
  suggestions: TagSuggestion[];
  query: string;
  highlightedIndex: number;
  getOptionId: (index: number) => string;
  onItemSelect: (index: number, shiftKey: boolean) => void;
  onItemHover: (index: number) => void;
  onListMouseLeave: () => void;
};

/**
 * Shared tag-autocomplete behaviour, following the ARIA combobox pattern:
 * focus stays in the host input, which drives the floating list through
 * `handleKeyDown` and `aria-activedescendant`.
 *
 * The keyboard contract — hosts call `handleKeyDown(e)` FIRST and skip their
 * own handling when it returns true:
 * - the list opens while the input is focused and the text matches tags;
 *   nothing is highlighted until the user arrows down, so Enter keeps its
 *   host meaning (submit the typed text) until a suggestion is chosen
 * - ArrowDown/ArrowUp own navigation while the list is open (consumed even at
 *   the ends, so they never leak into other keyboard nav); ArrowUp from the
 *   top clears the highlight, ArrowDown reopens a dismissed list
 * - Enter/Tab select only when a suggestion is highlighted, else fall through
 * - Escape dismisses the list and stops propagation, so a following Escape is
 *   the one that cancels the edit / closes the surrounding modal
 * - Space/Home/End are never consumed (tags contain spaces; caret keys stay
 *   caret keys)
 */
export const useTagAutocomplete = ({
  query,
  exclude,
  onSelect,
  anchorRef,
  enabled = true,
  limit = DEFAULT_SUGGESTION_LIMIT,
}: UseTagAutocompleteOptions) => {
  const { openPopup, closePopup, getPopupState } = usePopup();

  const reactId = useId();
  const popupId = `tag-autocomplete-${reactId}`;
  const listboxId = `${popupId}-listbox`;

  const [focused, setFocused] = useState(false);
  // Set by Escape; typing clears it so suggestions reappear on the next change
  const [dismissed, setDismissed] = useState(false);
  const [keyboardIndex, setKeyboardIndex] = useState(-1);
  const [hoverIndex, setHoverIndex] = useState(-1);
  const [anchorWidth, setAnchorWidth] = useState(0);

  const suggestions = useTagSuggestions(enabled ? query : '', exclude, limit);
  const { isOpen, shouldRender } = getPopupState(popupId);

  // Any edit to the text resets dismissal and the keyboard highlight — except
  // the change caused by a selection filling the input (fill-without-commit
  // hosts like rename fields), which would otherwise reopen the list over the
  // value that was just chosen.
  const prevQueryRef = useRef(query);
  const lastSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevQueryRef.current === query) return;
    prevQueryRef.current = query;
    setKeyboardIndex(-1);
    const wasSelectionFill = lastSelectedRef.current === query;
    lastSelectedRef.current = null;
    if (!wasSelectionFill) setDismissed(false);
  }, [query]);

  // Two-layer highlight like useListHighlight: mouse hover overrides the
  // keyboard anchor. Indices are clamped against the live list so a shrinking
  // result set can't leave a stale highlight.
  const count = suggestions.length;
  const highlightedIndex =
    hoverIndex >= 0 && hoverIndex < count
      ? hoverIndex
      : keyboardIndex >= 0 && keyboardIndex < count
        ? keyboardIndex
        : -1;

  const shouldOpen =
    enabled && focused && !dismissed && query.trim().length > 0 && count > 0;

  useEffect(() => {
    if (shouldOpen) {
      openPopup(popupId, { position: 'bottom-left', triggerRef: anchorRef });
    } else {
      closePopup(popupId);
    }
  }, [shouldOpen, openPopup, closePopup, popupId, anchorRef]);

  // Close on unmount (e.g. an edit-mode input being torn down mid-suggestion).
  // Via ref because closePopup's identity changes with unrelated popup state —
  // as a cleanup dependency it would close the list mid-session.
  const closePopupRef = useRef(closePopup);
  useEffect(() => {
    closePopupRef.current = closePopup;
  });
  useEffect(() => {
    return () => closePopupRef.current(popupId);
  }, [popupId]);

  // Match the list's minimum width to the input, re-measured as the input's
  // width steps up while typing (positioning keeps the left edges aligned)
  useLayoutEffect(() => {
    if (!shouldRender) return;
    const anchor = anchorRef.current;
    if (anchor) setAnchorWidth(anchor.offsetWidth);
  }, [shouldRender, query, anchorRef]);

  const getOptionId = useCallback(
    (index: number) => `${popupId}-option-${index}`,
    [popupId],
  );

  // Keep the keyboard highlight in view when the list scrolls (the Popup root
  // gains overflow-y when height-constrained), with a peek of the next row.
  // Keyed on keyboardIndex, not highlightedIndex — hover must never scroll.
  useEffect(() => {
    if (!isOpen || keyboardIndex < 0 || keyboardIndex >= count) return;
    const el = document.getElementById(getOptionId(keyboardIndex));
    if (!el) return;
    scrollOptionIntoView(el, {
      isFirst: keyboardIndex === 0,
      isLast: keyboardIndex === count - 1,
    });
  }, [isOpen, keyboardIndex, count, getOptionId]);

  const selectIndex = useCallback(
    (index: number, shiftKey: boolean) => {
      const suggestion = suggestions[index];
      if (!suggestion) return;
      lastSelectedRef.current = suggestion.tag;
      onSelect(suggestion.tag, shiftKey);
      setKeyboardIndex(-1);
      setHoverIndex(-1);
      // Belt-and-braces: if the host doesn't change the query, still close
      setDismissed(true);
    },
    [suggestions, onSelect],
  );

  /** Returns true when the event was consumed by the suggestion list. */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>): boolean => {
      if (!enabled) return false;

      if (!isOpen) {
        // ArrowDown reopens a list dismissed with Escape
        if (e.key === 'ArrowDown' && dismissed && count > 0) {
          e.preventDefault();
          setDismissed(false);
          return true;
        }
        return false;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          e.stopPropagation();
          setHoverIndex(-1);
          setKeyboardIndex(Math.min(highlightedIndex + 1, count - 1));
          return true;
        case 'ArrowUp':
          e.preventDefault();
          e.stopPropagation();
          setHoverIndex(-1);
          setKeyboardIndex(Math.max(highlightedIndex - 1, -1));
          return true;
        case 'Enter':
          if (highlightedIndex < 0) return false;
          e.preventDefault();
          e.stopPropagation();
          selectIndex(highlightedIndex, e.shiftKey);
          return true;
        case 'Tab':
          if (highlightedIndex < 0) return false;
          e.preventDefault();
          e.stopPropagation();
          selectIndex(highlightedIndex, e.shiftKey);
          return true;
        case 'Escape':
          e.preventDefault();
          e.stopPropagation();
          setDismissed(true);
          return true;
        default:
          return false;
      }
    },
    [enabled, isOpen, dismissed, count, highlightedIndex, selectIndex],
  );

  const handleFocus = useCallback(() => setFocused(true), []);
  const handleBlur = useCallback(() => {
    setFocused(false);
    setKeyboardIndex(-1);
    setHoverIndex(-1);
  }, []);

  const onItemHover = useCallback((index: number) => setHoverIndex(index), []);
  const onListMouseLeave = useCallback(() => setHoverIndex(-1), []);

  /** ARIA combobox attributes to spread on the host input. */
  const inputProps = useMemo(
    () =>
      enabled
        ? {
            role: 'combobox' as const,
            'aria-autocomplete': 'list' as const,
            'aria-expanded': isOpen,
            'aria-controls': isOpen ? listboxId : undefined,
            'aria-activedescendant':
              highlightedIndex >= 0 ? getOptionId(highlightedIndex) : undefined,
            autoComplete: 'off',
          }
        : {},
    [enabled, isOpen, listboxId, highlightedIndex, getOptionId],
  );

  const control: TagAutocompleteControl = {
    popupId,
    listboxId,
    anchorRef,
    anchorWidth,
    suggestions,
    query,
    highlightedIndex,
    getOptionId,
    onItemSelect: selectIndex,
    onItemHover,
    onListMouseLeave,
  };

  return {
    isOpen,
    handleKeyDown,
    handleFocus,
    handleBlur,
    inputProps,
    control,
  };
};
