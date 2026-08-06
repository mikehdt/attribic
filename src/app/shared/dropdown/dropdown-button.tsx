'use client';

import { ChevronDownIcon } from 'lucide-react';
import { ReactNode, useCallback, useId, useRef } from 'react';

import { Popup, usePopup } from '../popup';
import {
  DROPDOWN_MENU_CLASS,
  type DropdownSize,
  dropdownTriggerClass,
  type DropdownVariant,
} from './dropdown-styles';

interface DropdownButtonProps {
  /** Trigger content, rendered before the chevron */
  label: ReactNode;
  /**
   * Popup contents. Given a `close` callback for panels that dismiss
   * themselves after an action. Only rendered while the popup is open, so a
   * component here remounts (and resets its state) on each open.
   */
  children: ReactNode | ((close: () => void) => ReactNode);
  size?: DropdownSize;
  variant?: DropdownVariant;
  alignRight?: boolean;
  openUpward?: boolean;
  disabled?: boolean;
  title?: string;
  'aria-label'?: string;
  /** Classes for the wrapper element */
  className?: string;
  /** Classes for the trigger button */
  buttonClassName?: string;
  /** Classes for the popup surface — typically a width (`w-64`, `min-w-72`) */
  menuClassName?: string;
}

/**
 * A dropdown-styled trigger that opens an arbitrary panel rather than a list
 * of options — the hybrid between <Button> and <Dropdown>. Use it whenever a
 * control should read as a dropdown but its popup holds custom content
 * (filters, a project switcher, a settings panel).
 *
 * For a plain list of selectable values, use <Dropdown> instead: it brings
 * listbox semantics and keyboard navigation, which this deliberately doesn't
 * (the panel owns its own interaction model).
 *
 * Requires a PopupProvider ancestor.
 */
export const DropdownButton = ({
  label,
  children,
  size = 'sm',
  variant = 'default',
  alignRight = false,
  openUpward = false,
  disabled = false,
  title,
  'aria-label': ariaLabel,
  className = '',
  buttonClassName = '',
  menuClassName = '',
}: DropdownButtonProps) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { openPopup, closePopup, getPopupState } = usePopup();
  const popupId = useId();
  const isOpen = getPopupState(popupId).isOpen;

  const position = openUpward
    ? alignRight
      ? 'top-right'
      : 'top-left'
    : alignRight
      ? 'bottom-right'
      : 'bottom-left';

  const close = useCallback(() => {
    closePopup(popupId);
  }, [closePopup, popupId]);

  const handleClick = useCallback(() => {
    if (isOpen) {
      closePopup(popupId);
    } else {
      openPopup(popupId, { position, triggerRef: buttonRef });
    }
  }, [isOpen, openPopup, closePopup, popupId, position]);

  return (
    <div className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleClick}
        disabled={disabled}
        title={title}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        className={`flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50 ${dropdownTriggerClass(
          { size, variant, isOpen },
        )} ${buttonClassName}`}
      >
        {label}
        <ChevronDownIcon
          className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      <Popup
        id={popupId}
        position={position}
        triggerRef={buttonRef}
        className={`${DROPDOWN_MENU_CLASS} ${menuClassName}`}
      >
        {typeof children === 'function' ? children(close) : children}
      </Popup>
    </div>
  );
};
