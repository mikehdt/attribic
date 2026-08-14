import { useCallback, useEffect, useMemo, useRef } from 'react';

import {
  type ImageAsset,
  selectFilteredAssets,
  selectSortDirection,
  selectSortType,
  SortType,
} from '@/app/store/assets';
import {
  clearVisibilityFilters,
  selectPaginationSize,
} from '@/app/store/filters';
import { useAppDispatch, useAppSelector, useAppStore } from '@/app/store/hooks';
import {
  adoptCurrentAssetAsRangeAnchor,
  clearClickTracking,
  selectCurrentAssetId,
  selectSelectedAssets,
  selectShiftHoverPreview,
  setShiftHoverAssetId,
} from '@/app/store/selection';
import { groupAssetsByCategory } from '@/app/tagging/utils/category-utils';
import { useAnchorScrolling } from '@/app/tagging/utils/use-anchor-scrolling';

/** An asset annotated with its position within the paginated, filtered list. */
interface AssetWithPaginationIndex extends ImageAsset {
  paginatedIndex: number;
  filteredIndex: number; // 1-based position in full filtered list
}

export type GroupedAssets = {
  category: string;
  assets: AssetWithPaginationIndex[];
}[];

export type ShiftHoverPreview = ReturnType<typeof selectShiftHoverPreview>;

// Moving between grid cells crosses the gutter, firing mouseleave before the
// next mouseenter. Clearing the hover immediately would drop the whole range
// preview for those few frames, which reads as a flicker. Holding the clear
// briefly lets the re-enter cancel it, so the preview only ever fades out when
// the pointer genuinely leaves the assets.
const HOVER_CLEAR_DELAY_MS = 120;

/**
 * All renderer-agnostic gallery state: filtering, pagination, category
 * grouping, shift-range tracking and hover preview. The list and grid views
 * are thin renderers over this one hook, which is what keeps them in lockstep
 * — switching views never changes what you're looking at, only how.
 */
export const useAssetGallery = (currentPage: number) => {
  // Handle anchor scrolling for cross-page navigation
  useAnchorScrolling();

  const dispatch = useAppDispatch();
  const store = useAppStore();

  // Track whether shift key is currently held. A ref, not state: nothing
  // renders from it, and a state flip would change handleAssetHover's
  // identity — failing every asset memo on each shift press/release
  const isShiftHeldRef = useRef(false);
  // Track currently hovered asset (using ref to avoid re-renders on hover)
  const hoveredAssetRef = useRef<string | null>(null);
  // Pending gutter-crossing clear, see HOVER_CLEAR_DELAY_MS
  const hoverClearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const cancelPendingHoverClear = useCallback(() => {
    if (hoverClearTimeoutRef.current !== null) {
      clearTimeout(hoverClearTimeoutRef.current);
      hoverClearTimeoutRef.current = null;
    }
  }, []);

  // Clear shift-click tracking when page changes
  useEffect(() => {
    dispatch(clearClickTracking());
  }, [currentPage, dispatch]);

  // Track shift key state globally (subscribed once — no per-toggle churn)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && !isShiftHeldRef.current) {
        isShiftHeldRef.current = true;
        // Pressing Shift starts a range, so pin where it starts from before
        // the gesture can move the highlight (see the thunk). No-op once a
        // real selection click has set an anchor.
        dispatch(adoptCurrentAssetAsRangeAnchor());
        // If already hovering an asset when shift is pressed, update Redux;
        // with no hover, the keyboard's current asset previews instead, so
        // Shift+arrow range selection lights up the same way the mouse does
        const target =
          hoveredAssetRef.current ?? selectCurrentAssetId(store.getState());
        if (target) {
          dispatch(setShiftHoverAssetId(target));
        }
      }
    };
    // Releasing shift is an explicit "stop previewing" — clear it at once
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        isShiftHeldRef.current = false;
        cancelPendingHoverClear();
        dispatch(setShiftHoverAssetId(null));
      }
    };
    // Also clear on blur (window loses focus)
    const handleBlur = () => {
      isShiftHeldRef.current = false;
      cancelPendingHoverClear();
      dispatch(setShiftHoverAssetId(null));
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      cancelPendingHoverClear();
    };
  }, [cancelPendingHoverClear, dispatch, store]);

  const paginationSize = useAppSelector(selectPaginationSize);
  const sortType = useAppSelector(selectSortType);
  const sortDirection = useAppSelector(selectSortDirection);
  const selectedAssets = useAppSelector(selectSelectedAssets);

  // Only use selectedAssets for grouping when sorting by selection
  // This prevents unnecessary re-renders when selection changes but sort type doesn't need it
  const selectedAssetsForGrouping = useMemo(
    () => (sortType === SortType.SELECTED ? selectedAssets : []),
    [sortType, selectedAssets],
  );

  // Get filtered assets from the selector (this handles all filtering logic)
  const filteredAssets = useAppSelector(selectFilteredAssets);

  // Apply pagination to the filtered assets
  const paginatedAssets = useMemo(() => {
    if (paginationSize === -1) return filteredAssets; // -1 is PaginationSize.ALL

    const start = (currentPage - 1) * paginationSize;
    return filteredAssets.slice(start, start + paginationSize);
  }, [filteredAssets, currentPage, paginationSize]);

  // Handler for asset hover - always track in ref, dispatch to Redux only if
  // shift is held. Stable identity (shift read via ref) keeps asset memos intact
  const handleAssetHover = useCallback(
    (assetId: string | null) => {
      hoveredAssetRef.current = assetId;
      if (!isShiftHeldRef.current) return;

      cancelPendingHoverClear();

      if (assetId === null) {
        hoverClearTimeoutRef.current = setTimeout(() => {
          hoverClearTimeoutRef.current = null;
          dispatch(setShiftHoverAssetId(null));
        }, HOVER_CLEAR_DELAY_MS);
        return;
      }

      dispatch(setShiftHoverAssetId(assetId));
    },
    [cancelPendingHoverClear, dispatch],
  );

  // Group assets by sort category. The shared helper is the single source of
  // truth for display order, so the shift-select range below matches the render.
  const groupedAssets: GroupedAssets = useMemo(() => {
    // Pre-calculate the start index for filtered index calculation
    const startIndex =
      (currentPage - 1) * (paginationSize === -1 ? 0 : paginationSize);

    const assetsWithIndex: AssetWithPaginationIndex[] = paginatedAssets.map(
      (asset, index) => ({
        ...asset,
        paginatedIndex: index,
        filteredIndex: startIndex + index + 1, // 1-based position in full filtered list
      }),
    );

    return groupAssetsByCategory(
      assetsWithIndex,
      sortType,
      sortDirection,
      selectedAssetsForGrouping,
    );
  }, [
    paginatedAssets,
    sortType,
    sortDirection,
    selectedAssetsForGrouping,
    currentPage,
    paginationSize,
  ]);

  // Display-ordered asset IDs for the current page, flattened from the exact
  // grouped structure that gets rendered. Shift-range selection keys off this so
  // the highlighted range always matches the on-screen order (not the raw
  // selectFilteredAssets order, which can differ once categories are grouped).
  const paginatedAssetIds = useMemo(
    () => groupedAssets.flatMap(({ assets }) => assets.map((a) => a.fileId)),
    [groupedAssets],
  );

  // Get shift-hover preview state
  const shiftHoverPreview = useAppSelector((state) =>
    selectShiftHoverPreview(state, paginatedAssetIds),
  );

  // Same as the top-shelf clear-filters button: stop filtering but keep the
  // selection lists — empty results are always caused by active filtering.
  const handleClearFilters = useCallback(
    () => dispatch(clearVisibilityFilters()),
    [dispatch],
  );

  return {
    hasResults: filteredAssets.length > 0,
    groupedAssets,
    // Hide headers when there's only one category
    showCategoryHeaders: groupedAssets.length > 1,
    paginatedAssetIds,
    shiftHoverPreview,
    handleAssetHover,
    handleClearFilters,
  };
};
