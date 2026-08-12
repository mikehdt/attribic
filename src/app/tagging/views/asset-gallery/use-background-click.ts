import { MouseEvent, useCallback } from 'react';

import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import { selectCurrentAssetId, setCurrentAsset } from '@/app/store/selection';

// Everything a click can land on inside the gallery that isn't background:
// the assets themselves, the grid's inspector panel, the sticky category
// headers (clicking one scrolls the section) and any control layered over
// them. The shelves and dialogs sit outside the gallery container, so they
// need no exemption here.
const BACKGROUND_CLICK_EXEMPT =
  '[data-asset-id], [data-grid-inspector], [data-category-header], button, a, input, textarea, select, [role="button"], [role="checkbox"], [role="switch"]';

/**
 * Clicking the gallery background drops the current-asset highlight — the
 * mouse equivalent of Escape, and the counterpart to clicking an asset to
 * move the highlight onto it. Returns a handler for the view's background
 * element; clicks that reach it from an asset or a control are ignored.
 */
export const useClearCurrentOnBackgroundClick = () => {
  const dispatch = useAppDispatch();
  const currentAssetId = useAppSelector(selectCurrentAssetId);

  return useCallback(
    (e: MouseEvent) => {
      if (!currentAssetId) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest(BACKGROUND_CLICK_EXEMPT)) return;
      dispatch(setCurrentAsset(null));
    },
    [currentAssetId, dispatch],
  );
};
