import { ChevronDownIcon } from 'lucide-react';
import React, {
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { Popup, usePopup } from '../popup';
import { useListHighlight } from '../popup/use-list-highlight';
import {
  DROPDOWN_MENU_CLASS,
  type DropdownSize,
  dropdownSizeClass,
  dropdownTriggerClass,
  type DropdownVariant,
} from './dropdown-styles';

/**
 * Dropdown Item interface - defines the structure of each dropdown option
 */
export interface DropdownItem<T> {
  /** Unique value for the item */
  value: T;
  /** Display text/element for the item */
  label: ReactNode;
  /** Whether this item is disabled */
  disabled?: boolean;
}

/**
 * A named group of dropdown items, rendered with a non-selectable header
 */
export interface DropdownGroup<T> {
  /** Label shown as the group header */
  groupLabel: ReactNode;
  /** Items within this group */
  items: DropdownItem<T>[];
}

/** A single entry in the flattened list: either a selectable item or a group header */
type FlatEntry<T> =
  | { kind: 'item'; item: DropdownItem<T> }
  | { kind: 'group-header'; label: ReactNode };

/** Type guard to distinguish groups from items */
function isDropdownGroup<T>(
  entry: DropdownItem<T> | DropdownGroup<T>,
): entry is DropdownGroup<T> {
  return 'groupLabel' in entry;
}

/** Flatten mixed items/groups into a single list for rendering and navigation */
function flattenEntries<T>(
  items: (DropdownItem<T> | DropdownGroup<T>)[],
): FlatEntry<T>[] {
  const result: FlatEntry<T>[] = [];
  for (const entry of items) {
    if (isDropdownGroup(entry)) {
      result.push({ kind: 'group-header', label: entry.groupLabel });
      for (const item of entry.items) {
        result.push({ kind: 'item', item });
      }
    } else {
      result.push({ kind: 'item', item: entry });
    }
  }
  return result;
}

/**
 * Props for the Dropdown component
 */
interface DropdownProps<T> {
  items: (DropdownItem<T> | DropdownGroup<T>)[];
  selectedValue: T;
  onChange: (value: T) => void;
  selectedValueRenderer?: (item: DropdownItem<T>) => ReactNode;
  /** Text shown when no item is selected (selectedValue doesn't match any item) */
  placeholder?: string;
  /** Accessible label for the dropdown (used as aria-label on the trigger button) */
  'aria-label'?: string;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  itemClassName?: string;
  selectedItemClassName?: string;
  disabledItemClassName?: string;
  alignRight?: boolean;
  openUpward?: boolean;
  size?: DropdownSize;
  variant?: DropdownVariant;
  fullWidth?: boolean;
  /**
   * Rendered pinned below the option list, inside the popup. For controls
   * that adjust the list itself (filters, toggles) — interacting with it
   * does not select anything or close the dropdown.
   */
  footer?: ReactNode;
}

/** Minimum width for the popup menu (matches Tailwind min-w-40 = 10rem) */
const MIN_MENU_WIDTH = 160;

/**
 * A reusable dropdown component with listbox semantics and keyboard navigation.
 * Requires a PopupProvider ancestor in the component tree.
 *
 * When only one selectable (non-disabled) item exists, renders as static text
 * instead of an interactive dropdown.
 */
export function Dropdown<T>({
  items,
  selectedValue,
  onChange,
  selectedValueRenderer,
  placeholder,
  'aria-label': ariaLabel,
  className = '',
  buttonClassName = '',
  menuClassName = '',
  itemClassName = '',
  selectedItemClassName = '',
  disabledItemClassName = '',
  alignRight = false,
  openUpward = false,
  size = 'md',
  variant = 'default',
  fullWidth = false,
  footer,
}: DropdownProps<T>) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const { openPopup, closePopup, getPopupState } = usePopup();

  const popupId = `dropdown-${React.useId()}`;
  const listboxId = `${popupId}-listbox`;
  const { isOpen, shouldRender } = getPopupState(popupId);

  // Track trigger width for fullWidth mode
  const [triggerWidth, setTriggerWidth] = useState(0);

  // Flatten groups into a single list for rendering and navigation
  const flatEntries = useMemo(() => flattenEntries(items), [items]);

  // Detect single-option mode: only one selectable (non-disabled) item
  const singleItem = useMemo(() => {
    const selectable = flatEntries.filter(
      (e) => e.kind === 'item' && !e.item.disabled,
    );
    if (selectable.length === 1) {
      return (selectable[0] as { kind: 'item'; item: DropdownItem<T> }).item;
    }
    return null;
  }, [flatEntries]);

  // Find the selected item in the flattened list
  const selectedItem = flatEntries.find(
    (e) => e.kind === 'item' && e.item.value === selectedValue,
  );
  const selectedIndex = flatEntries.findIndex(
    (e) => e.kind === 'item' && e.item.value === selectedValue,
  );
  const selectedDropdownItem =
    selectedItem?.kind === 'item' ? selectedItem.item : undefined;

  // Navigability predicate for the shared highlight hook
  const isNavigable = useCallback(
    (index: number) => {
      const entry = flatEntries[index];
      return entry?.kind === 'item' && !entry.item.disabled;
    },
    [flatEntries],
  );

  // Handle item selection by index
  const handleSelectIndex = useCallback(
    (index: number) => {
      const entry = flatEntries[index];
      if (entry?.kind === 'item' && !entry.item.disabled) {
        onChange(entry.item.value);
        closePopup(popupId);
        buttonRef.current?.focus();
      }
    },
    [flatEntries, onChange, closePopup, popupId],
  );

  const handleClose = useCallback(() => {
    closePopup(popupId);
    buttonRef.current?.focus();
  }, [closePopup, popupId]);

  const {
    highlightedIndex,
    getOptionId,
    activeDescendant,
    resetHighlight,
    handlePositioned,
    handleKeyDown,
    getItemHoverProps,
  } = useListHighlight({
    count: flatEntries.length,
    isNavigable,
    isOpen,
    onSelect: handleSelectIndex,
    onClose: handleClose,
    initialIndex: selectedIndex,
  });

  // When fullWidth, the menu should be at least as wide as the trigger button
  // (floored at the standard min-w-40 baseline).
  // Keyed on shouldRender so the minWidth is present during positioning,
  // while open, and through the closing animation — preventing width "pops".
  const popupStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (!fullWidth || !shouldRender) return undefined;
    return { minWidth: Math.max(triggerWidth, MIN_MENU_WIDTH) };
  }, [fullWidth, shouldRender, triggerWidth]);

  // Measure trigger width synchronously before paint (useLayoutEffect) so the
  // popup's positioning phase already has the correct minWidth — avoids an
  // animated width "pop" caused by the async ResizeObserver firing after the
  // popup becomes visible. The ResizeObserver then tracks subsequent resizes.
  useLayoutEffect(() => {
    if (!fullWidth || !shouldRender) return;
    const button = buttonRef.current;
    if (!button) return;

    setTriggerWidth(button.offsetWidth);
  }, [fullWidth, shouldRender]);

  useEffect(() => {
    if (!fullWidth || !shouldRender) return;
    const button = buttonRef.current;
    if (!button) return;

    const observer = new ResizeObserver(() => {
      setTriggerWidth(button.offsetWidth);
    });

    observer.observe(button);

    return () => {
      observer.disconnect();
    };
  }, [fullWidth, shouldRender]);

  // Determine popup position based on alignment and direction
  const position = openUpward
    ? alignRight
      ? 'top-right'
      : 'top-left'
    : alignRight
      ? 'bottom-right'
      : 'bottom-left';

  const doOpen = useCallback(() => {
    openPopup(popupId, { position, triggerRef: buttonRef });
  }, [openPopup, popupId, position]);

  const doClose = useCallback(() => {
    closePopup(popupId);
    resetHighlight();
    buttonRef.current?.focus();
  }, [closePopup, popupId, resetHighlight]);

  // Handle keyboard navigation on the trigger button
  const handleButtonKeyDown = (e: React.KeyboardEvent) => {
    if (isOpen) {
      handleKeyDown(e);
      return;
    }
    switch (e.key) {
      case 'Enter':
      case ' ':
      case 'ArrowDown':
      case 'ArrowUp':
        doOpen();
        e.preventDefault();
        break;
    }
  };

  // Handle item click
  const handleItemClick = (item: DropdownItem<T>) => {
    if (!item.disabled) {
      onChange(item.value);
      doClose();
    }
  };

  // Prevent clicks on items from stealing focus from the button
  const handleItemMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  // Handle blur event on the button
  const handleButtonBlur = (e: React.FocusEvent) => {
    // Check if the next focus is within the popup (i.e. the listbox)
    const popupElement = document.querySelector(`[data-popup-id="${popupId}"]`);
    if (!popupElement?.contains(e.relatedTarget as Node)) {
      setTimeout(() => closePopup(popupId), 100);
    }
  };

  const handleClick = useCallback(() => {
    if (isOpen) {
      doClose();
    } else {
      doOpen();
    }
  }, [isOpen, doClose, doOpen]);

  // Single selectable item → render as static text (no interaction needed)
  if (singleItem) {
    return (
      <div
        className={`relative ${fullWidth ? 'w-full' : 'inline-flex'} ${className}`}
      >
        <div
          className={`flex min-w-40 items-center rounded-sm border border-slate-300 whitespace-nowrap dark:border-slate-700 ${
            fullWidth ? 'w-full' : ''
          } ${dropdownSizeClass[size]} text-slate-500 dark:text-slate-400 ${buttonClassName}`}
          aria-label={ariaLabel}
        >
          {selectedValueRenderer
            ? selectedValueRenderer(singleItem)
            : singleItem.label}
        </div>
      </div>
    );
  }

  return (
    <div className={`relative ${fullWidth ? 'w-full' : ''} ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleClick}
        onKeyDown={handleButtonKeyDown}
        onBlur={handleButtonBlur}
        className={`flex min-w-20 items-center justify-between ${dropdownTriggerClass(
          { size, variant, isOpen },
        )} ${fullWidth ? 'w-full' : ''} ${buttonClassName}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-label={ariaLabel}
      >
        <span
          className={
            !selectedDropdownItem && placeholder
              ? 'text-slate-400 dark:text-slate-300'
              : ''
          }
        >
          {selectedDropdownItem
            ? selectedValueRenderer
              ? selectedValueRenderer(selectedDropdownItem)
              : selectedDropdownItem.label
            : (placeholder ?? '')}
        </span>
        <ChevronDownIcon
          className={`ml-2 h-3 w-3 transition-transform ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      <Popup
        id={popupId}
        position={position}
        triggerRef={buttonRef}
        onPositioned={handlePositioned}
        style={popupStyle}
        className={`${
          fullWidth ? '' : 'min-w-40'
        } ${DROPDOWN_MENU_CLASS} whitespace-nowrap ${menuClassName}`}
      >
        <div
          ref={listboxRef}
          id={listboxId}
          className="min-w-50 divide-y divide-slate-100 dark:divide-slate-800"
          role="listbox"
          aria-label={ariaLabel}
          aria-activedescendant={activeDescendant}
        >
          {flatEntries.map((entry, index) =>
            entry.kind === 'group-header' ? (
              <div
                key={index}
                className="px-3 pt-3 pb-1 text-xs font-semibold tracking-wide text-slate-400 uppercase select-none dark:text-slate-500"
                role="presentation"
              >
                {entry.label}
              </div>
            ) : (
              <div
                key={index}
                id={getOptionId(index)}
                onMouseDown={handleItemMouseDown}
                onClick={() => handleItemClick(entry.item)}
                {...getItemHoverProps(index)}
                className={`block w-full px-3 py-2 text-left text-sm outline-none ${
                  index === highlightedIndex
                    ? entry.item.value === selectedValue
                      ? `bg-blue-200 font-medium dark:bg-blue-800 ${selectedItemClassName}`
                      : `bg-blue-50 dark:bg-slate-700 ${itemClassName}`
                    : entry.item.value === selectedValue
                      ? `bg-blue-100 font-medium dark:bg-blue-900 ${selectedItemClassName}`
                      : itemClassName
                } ${
                  entry.item.disabled
                    ? `cursor-not-allowed text-slate-300 dark:text-slate-500 ${disabledItemClassName}`
                    : 'cursor-pointer'
                }`}
                role="option"
                aria-selected={entry.item.value === selectedValue}
                aria-disabled={entry.item.disabled || undefined}
              >
                {entry.item.label}
              </div>
            ),
          )}
        </div>

        {footer && (
          // Mousedown is swallowed so footer clicks don't blur the trigger,
          // which would close the popup mid-interaction.
          <div
            className="border-t border-slate-200 dark:border-slate-600"
            onMouseDown={handleItemMouseDown}
            role="presentation"
          >
            {footer}
          </div>
        )}
      </Popup>
    </div>
  );
}
