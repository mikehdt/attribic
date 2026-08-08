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
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import {
  clearClickTracking,
  selectSelectedAssets,
  selectShiftHoverPreview,
  setShiftHoverAssetId,
} from '@/app/store/selection';
import { groupAssetsByCategory } from '@/app/tagging/utils/category-utils';
import { useAnchorScrolling } from '@/app/tagging/utils/use-anchor-scrolling';

/** An asset annotated with its position within the paginated, filtered list. */
export interface AssetWithPaginationIndex extends ImageAsset {
  paginatedIndex: number;
  filteredIndex: number; // 1-based position in full filtered list
}

export type GroupedAssets = {
  category: string;
  assets: AssetWithPaginationIndex[];
}[];

export type ShiftHoverPreview = ReturnType<typeof selectShiftHoverPreview>;

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

  // Track whether shift key is currently held. A ref, not state: nothing
  // renders from it, and a state flip would change handleAssetHover's
  // identity — failing every asset memo on each shift press/release
  const isShiftHeldRef = useRef(false);
  // Track currently hovered asset (using ref to avoid re-renders on hover)
  const hoveredAssetRef = useRef<string | null>(null);

  // Clear shift-click tracking when page changes
  useEffect(() => {
    dispatch(clearClickTracking());
  }, [currentPage, dispatch]);

  // Track shift key state globally (subscribed once — no per-toggle churn)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && !isShiftHeldRef.current) {
        isShiftHeldRef.current = true;
        // If already hovering an asset when shift is pressed, update Redux
        if (hoveredAssetRef.current) {
          dispatch(setShiftHoverAssetId(hoveredAssetRef.current));
        }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        isShiftHeldRef.current = false;
        dispatch(setShiftHoverAssetId(null));
      }
    };
    // Also clear on blur (window loses focus)
    const handleBlur = () => {
      isShiftHeldRef.current = false;
      dispatch(setShiftHoverAssetId(null));
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [dispatch]);

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
      if (isShiftHeldRef.current) {
        dispatch(setShiftHoverAssetId(assetId));
      }
    },
    [dispatch],
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
