import { useEffect, useRef } from 'react';

import { isTypingContextBlocked } from './use-asset-keyboard-nav';

/**
 * `z` toggles the current asset's image zoom — the keyboard twin of clicking
 * the image (list row zoom, grid inspector expansion). A bare letter is fine
 * here because the action is view-only and harmless if mis-fired; it stays
 * inert while typing, but — unlike the nav layer — deliberately stays live
 * while focus walks the editing surface's tag chips, so a tagging pass can
 * peek at the image without leaving the tags. Mount with `isActive` true on
 * at most one surface at a time (the current row / the inspected asset).
 */
export const useZoomKey = (isActive: boolean, onToggle: () => void) => {
  // Ref so the listener never re-binds on the toggle's per-render identity
  const toggleRef = useRef(onToggle);

  useEffect(() => {
    toggleRef.current = onToggle;
  }, [onToggle]);

  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key.toLowerCase() !== 'z' ||
        e.ctrlKey ||
        e.altKey ||
        e.metaKey ||
        e.shiftKey
      ) {
        return;
      }
      if (isTypingContextBlocked(e)) return;
      e.preventDefault();
      toggleRef.current();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive]);
};
