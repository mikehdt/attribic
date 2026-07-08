import { KeyboardEvent, MutableRefObject, RefObject, useCallback } from 'react';

export const useKeyboardNavigation = (
  listLength: number,
  selectedIndex: number,
  setSelectedIndex: (index: number) => void,
  onClose: () => void,
  inputRef: RefObject<HTMLInputElement | null>,
  keyboardIndexRef: MutableRefObject<number>,
) => {
  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault(); // Prevent cursor movement in input
        const next =
          selectedIndex < listLength - 1 ? selectedIndex + 1 : selectedIndex;
        keyboardIndexRef.current = next;
        setSelectedIndex(next);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault(); // Prevent cursor movement in input
        const next = selectedIndex > 0 ? selectedIndex - 1 : 0;
        keyboardIndexRef.current = next;
        setSelectedIndex(next);
      } else if (e.key === 'Enter' && selectedIndex >= 0) {
        // Inform listeners that an item was selected with keyboard
        e.preventDefault();
        keyboardIndexRef.current = selectedIndex;
        document.dispatchEvent(
          new CustomEvent('filterlist:keyboardselect', {
            detail: { index: selectedIndex, shiftKey: e.shiftKey },
          }),
        );
        // We'll maintain the selected index and just focus back on the input
        if (inputRef.current) {
          inputRef.current.focus();
        }
      } else if (e.key === 'Escape') {
        // Clear selection first, if another Escape is pressed, close the panel
        if (selectedIndex >= 0) {
          e.preventDefault();
          keyboardIndexRef.current = -1;
          setSelectedIndex(-1);
        } else {
          onClose();
        }
      }
    },
    [
      listLength,
      selectedIndex,
      setSelectedIndex,
      onClose,
      inputRef,
      keyboardIndexRef,
    ],
  );

  return { handleKeyDown };
};
