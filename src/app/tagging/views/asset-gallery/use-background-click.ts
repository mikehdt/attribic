import { useEffect } from 'react';

import { useAppDispatch, useAppStore } from '@/app/store/hooks';
import { selectCurrentAssetId, setCurrentAsset } from '@/app/store/selection';

// Everything a click can land on that isn't background: the assets themselves,
// the grid's inspector panel, the sticky category headers (clicking one scrolls
// the section) and any control layered over them. The listener spans the whole
// window, so the fixed shelves, dialogs, popups and toasts have to be exempt
// too — they sit outside the gallery container, but clicks on them still reach
// the window.
const BACKGROUND_CLICK_EXEMPT =
  '[data-asset-id], [data-grid-inspector], [data-category-header], [data-top-shelf], [data-bottom-shelf], [data-popup-id], [role="dialog"], [role="alert"], button, a, input, textarea, select, [role="button"], [role="checkbox"], [role="switch"]';

/**
 * Clicking the background drops the current-asset highlight — the mouse
 * equivalent of Escape, and the counterpart to clicking an asset to move the
 * highlight onto it. Bound to the window rather than to the gallery element so
 * the margins either side of the centred layout count as background as well,
 * not just the gaps between assets.
 *
 * Capture phase, because React flushes its own updates before a bubble-phase
 * listener would run: a target the resulting render detaches matches nothing
 * under `closest`, which would then read as a background click.
 */
export const useClearCurrentOnBackgroundClick = () => {
  const dispatch = useAppDispatch();
  const store = useAppStore();

  useEffect(() => {
    const handleClick = (e: globalThis.MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (!selectCurrentAssetId(store.getState())) return;
      if (target.closest(BACKGROUND_CLICK_EXEMPT)) return;
      dispatch(setCurrentAsset(null));
    };

    window.addEventListener('click', handleClick, true);
    return () => window.removeEventListener('click', handleClick, true);
  }, [dispatch, store]);
};
