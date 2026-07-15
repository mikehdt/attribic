import React, { ReactNode, useCallback, useId, useRef } from 'react';

import { Button } from '../button';
import { Popup, usePopup } from '../popup';
import { useListHighlight } from '../popup/use-list-highlight';

export type MenuItem = {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
};

type MenuButtonProps = {
  icon: ReactNode;
  items: MenuItem[];
  title?: string;
  disabled?: boolean;
  position?: 'bottom-left' | 'bottom-right';
};

/**
 * A button that opens a popup menu with action items.
 * Simpler than Dropdown - no "selected value" concept, just a list of actions.
 *
 * Uses aria-activedescendant pattern: focus stays on the trigger button while
 * the highlighted item is tracked via state, matching the Dropdown behaviour.
 */
export const MenuButton = ({
  icon,
  items,
  title,
  disabled = false,
  position = 'bottom-left',
}: MenuButtonProps) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { openPopup, closePopup, getPopupState } = usePopup();

  const popupId = useId();
  const { isOpen } = getPopupState(popupId);

  const isNavigable = useCallback(
    (index: number) => !items[index]?.disabled,
    [items],
  );

  const handleClose = useCallback(() => {
    closePopup(popupId);
    buttonRef.current?.focus();
  }, [closePopup, popupId]);

  const handleSelectIndex = useCallback(
    (index: number) => {
      const item = items[index];
      if (item && !item.disabled) {
        closePopup(popupId);
        item.onClick();
      }
    },
    [items, closePopup, popupId],
  );

  const {
    highlightedIndex,
    getOptionId,
    resetHighlight,
    handlePositioned,
    handleKeyDown,
    getItemHoverProps,
  } = useListHighlight({
    count: items.length,
    isNavigable,
    isOpen,
    onSelect: handleSelectIndex,
    onClose: handleClose,
  });

  const doOpen = useCallback(() => {
    openPopup(popupId, { position, triggerRef: buttonRef });
  }, [openPopup, popupId, position]);

  const doClose = useCallback(() => {
    closePopup(popupId);
    resetHighlight();
    buttonRef.current?.focus();
  }, [closePopup, popupId, resetHighlight]);

  const handleClick = useCallback(() => {
    if (disabled) return;
    if (isOpen) {
      doClose();
    } else {
      doOpen();
    }
  }, [disabled, isOpen, doClose, doOpen]);

  const handleButtonKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (isOpen) {
      handleKeyDown(e);
      return;
    }

    switch (e.key) {
      case 'Enter':
      case ' ':
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault();
        doOpen();
        break;
    }
  };

  const handleItemClick = useCallback(
    (item: MenuItem) => {
      if (!item.disabled) {
        doClose();
        item.onClick();
      }
    },
    [doClose],
  );

  // Prevent clicks on items from stealing focus from the button
  const handleItemMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  const handleButtonBlur = (e: React.FocusEvent) => {
    const popupElement = document.querySelector(`[data-popup-id="${popupId}"]`);
    if (!popupElement?.contains(e.relatedTarget as Node)) {
      setTimeout(() => closePopup(popupId), 100);
    }
  };

  return (
    <div className="relative">
      <Button
        ref={buttonRef}
        type="button"
        variant="ghost"
        width="toolbar"
        size="toolbar"
        onClick={handleClick}
        onKeyDown={handleButtonKeyDown}
        onBlur={handleButtonBlur}
        disabled={disabled}
        isPressed={isOpen}
        ariaHasPopup="menu"
        ariaExpanded={isOpen}
        title={title}
      >
        {icon}
      </Button>

      <Popup
        id={popupId}
        position={position}
        triggerRef={buttonRef}
        onPositioned={handlePositioned}
        className="min-w-44 rounded-md border border-slate-200 bg-white py-1 shadow-md shadow-slate-600/50 dark:border-slate-600 dark:bg-slate-800 dark:shadow-slate-950/50 [&_svg]:w-4"
      >
        <div role="menu">
          {items.map((item, index) => (
            <div
              key={index}
              id={getOptionId(index)}
              onMouseDown={handleItemMouseDown}
              onClick={() => handleItemClick(item)}
              {...getItemHoverProps(index)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                index === highlightedIndex ? 'bg-blue-50 dark:bg-slate-700' : ''
              } ${
                item.disabled
                  ? 'cursor-not-allowed text-slate-300 dark:text-slate-500'
                  : 'cursor-pointer text-slate-700 dark:text-slate-300'
              }`}
              role="menuitem"
              aria-disabled={item.disabled || undefined}
            >
              {item.icon}
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </Popup>
    </div>
  );
};
