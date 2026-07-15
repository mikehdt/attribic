import { ListTodoIcon } from 'lucide-react';
import { memo, useCallback, useId, useRef } from 'react';

import { Button } from '@/app/shared/button';
import { Popup, usePopup } from '@/app/shared/popup';

import { FilterProvider } from './filter-context';
import { FilterPanel } from './filter-panel';

const FilterListButtonComponent = () => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { openPopup, closePopup, getPopupState } = usePopup();

  const popupId = useId();
  const isOpen = getPopupState(popupId).isOpen;

  const handleToggle = useCallback(() => {
    if (isOpen) {
      closePopup(popupId);
    } else {
      openPopup(popupId, {
        position: 'bottom-right',
        triggerRef: buttonRef,
      });
    }
  }, [isOpen, closePopup, openPopup, popupId]);

  const handleClose = useCallback(() => {
    closePopup(popupId);
  }, [closePopup, popupId]);

  const handlePositioned = useCallback(() => {
    // Use double rAF to ensure visibility:hidden is fully removed and painted
    // before attempting to focus (browsers won't focus hidden elements)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    });
  }, []);

  return (
    <div className="relative">
      <Button
        ref={buttonRef}
        variant="toggle"
        size="lg"
        width="lg"
        isPressed={isOpen}
        onClick={handleToggle}
        ariaHasPopup
        ariaExpanded={isOpen}
        title="Show filters"
      >
        <ListTodoIcon />
      </Button>

      <Popup
        id={popupId}
        position="bottom-right"
        triggerRef={buttonRef}
        onPositioned={handlePositioned}
        className="flex w-64 flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg shadow-slate-600/50 dark:border-slate-600 dark:bg-slate-800 dark:shadow-slate-950/50"
      >
        <FilterProvider onClose={handleClose} inputRef={inputRef}>
          <FilterPanel />
        </FilterProvider>
      </Popup>
    </div>
  );
};

export const FilterListButton = memo(FilterListButtonComponent);
