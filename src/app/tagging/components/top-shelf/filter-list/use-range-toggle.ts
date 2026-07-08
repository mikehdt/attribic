import { useCallback, useEffect, useMemo } from 'react';

import { FilterArrayKey, setFiltersRange } from '@/app/store/filters';
import { useAppDispatch } from '@/app/store/hooks';

import { useFilterContext } from './filter-context';

/**
 * Background tints for the pending-range hover preview (echoing the asset
 * grid's shift-hover preview). Each list's "would-select" tint relates to that
 * list; "would-deselect" is a shared muted rose that reads as "will be removed"
 * and stays distinct from every select colour.
 */
export const RANGE_PREVIEW_SELECT_TAGS = 'bg-teal-100/50 dark:bg-teal-900/50';
export const RANGE_PREVIEW_SELECT_SIZE = 'bg-sky-100/50 dark:bg-sky-900/50';
export const RANGE_PREVIEW_SELECT_BUCKETS =
  'bg-indigo-100/50 dark:bg-indigo-900/50';
export const RANGE_PREVIEW_SELECT_FILE = 'bg-slate-100/50 dark:bg-slate-600/50';
export const RANGE_PREVIEW_DESELECT_CLASS =
  'bg-rose-100/60 dark:bg-rose-900/60';

/** State of a row under the shift-hover range preview. */
export type RangePreviewState = 'select' | 'deselect' | null;

interface RangeToggleConfig<T> {
  /** The filtered/sorted items in display order. */
  items: T[];
  /** Filter value for an item (tag name, "WxH" size, extension, subfolder). */
  getValue: (item: T) => string;
  /** Whether an item is currently an active filter. */
  getIsActive: (item: T) => boolean;
  /** Which filter class this list toggles. */
  classKey: FilterArrayKey;
  /**
   * Offset between a local item index and the context's global selectedIndex.
   * Only non-zero for the file view's extension section (offset by the
   * subfolder count); defaults to 0.
   */
  indexOffset?: number;
}

/**
 * Shift-click / Shift+Return range selection for a filter menu list, mirroring
 * the asset grid: a plain click toggles an item and records an anchor with the
 * direction of that act (select vs deselect); a subsequent shift-action applies
 * that same direction to every item between the anchor and the target
 * (inclusive), then advances the anchor so ranges chain. Direction-agnostic and
 * robust to live re-sorting — the anchor is stored by value and resolved via
 * findIndex on each action.
 */
export const useRangeToggle = <T>({
  items,
  getValue,
  getIsActive,
  classKey,
  indexOffset = 0,
}: RangeToggleConfig<T>) => {
  const dispatch = useAppDispatch();
  const { rangeAnchor, setRangeAnchor, inputRef, selectedIndex, isShiftHeld } =
    useFilterContext();

  const handleItemAction = useCallback(
    (localIndex: number, shiftKey: boolean) => {
      if (localIndex < 0 || localIndex >= items.length) return;

      const focusInput = () => inputRef.current?.focus();

      // SHIFT PATH: extend the anchor's action across the range, provided the
      // anchor value is present in this list (else fall through to a toggle —
      // e.g. a shift-click that crosses from subfolders into extensions).
      if (shiftKey && rangeAnchor) {
        const anchorIndex = items.findIndex(
          (item) => getValue(item) === rangeAnchor.value,
        );
        if (anchorIndex !== -1) {
          const lo = Math.min(anchorIndex, localIndex);
          const hi = Math.max(anchorIndex, localIndex);
          const values = items.slice(lo, hi + 1).map(getValue);
          dispatch(
            setFiltersRange({
              classKey,
              values,
              selected: rangeAnchor.action === 'select',
            }),
          );
          // Advance the anchor to the clicked item, keeping the same direction.
          setRangeAnchor({
            value: getValue(items[localIndex]),
            action: rangeAnchor.action,
          });
          focusInput();
          return;
        }
      }

      // NORMAL PATH: toggle the single item and set the anchor to match.
      const item = items[localIndex];
      const wasActive = getIsActive(item);
      dispatch(
        setFiltersRange({
          classKey,
          values: [getValue(item)],
          selected: !wasActive,
        }),
      );
      setRangeAnchor({
        value: getValue(item),
        action: wasActive ? 'deselect' : 'select',
      });
      focusInput();
    },
    [
      items,
      getValue,
      getIsActive,
      classKey,
      dispatch,
      rangeAnchor,
      setRangeAnchor,
      inputRef,
    ],
  );

  // Keyboard selection (Enter / Shift+Enter on the highlighted row). The event
  // carries the global selectedIndex; map it into this list via indexOffset and
  // ignore it when it falls outside (e.g. an extension index reaching the
  // subfolder list in the file view).
  useEffect(() => {
    const onKeyboardSelect = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        { index?: number; shiftKey?: boolean } | undefined;
      if (detail?.index == null) return;
      const localIndex = detail.index - indexOffset;
      if (localIndex < 0 || localIndex >= items.length) return;
      handleItemAction(localIndex, Boolean(detail.shiftKey));
    };

    document.addEventListener('filterlist:keyboardselect', onKeyboardSelect);
    return () =>
      document.removeEventListener(
        'filterlist:keyboardselect',
        onKeyboardSelect,
      );
  }, [items.length, indexOffset, handleItemAction]);

  // Pending-range hover preview: while Shift is held with an anchor set, the
  // values between the anchor and the hovered row (inclusive) that would change
  // state, plus the direction of that change. Mirrors handleItemAction's range.
  const preview = useMemo(() => {
    if (!isShiftHeld || !rangeAnchor) return null;

    const hoverIndex = selectedIndex - indexOffset;
    if (hoverIndex < 0 || hoverIndex >= items.length) return null;

    const anchorIndex = items.findIndex(
      (item) => getValue(item) === rangeAnchor.value,
    );
    if (anchorIndex === -1 || anchorIndex === hoverIndex) return null;

    const lo = Math.min(anchorIndex, hoverIndex);
    const hi = Math.max(anchorIndex, hoverIndex);
    const values = new Set<string>();
    const selecting = rangeAnchor.action === 'select';
    for (let i = lo; i <= hi; i++) {
      // Only preview rows whose state would actually flip.
      if (getIsActive(items[i]) !== selecting) {
        values.add(getValue(items[i]));
      }
    }
    return { values, action: rangeAnchor.action };
  }, [
    isShiftHeld,
    rangeAnchor,
    selectedIndex,
    indexOffset,
    items,
    getValue,
    getIsActive,
  ]);

  const previewState = useCallback(
    (value: string): RangePreviewState =>
      preview && preview.values.has(value) ? preview.action : null,
    [preview],
  );

  return { handleItemAction, previewState };
};
