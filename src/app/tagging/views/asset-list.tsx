'use client';

import { BoxSelectIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  type ImageAsset,
  selectFilteredAssets,
  selectSortDirection,
  selectSortType,
  SortType,
} from '@/app/store/assets';
import { selectPaginationSize } from '@/app/store/filters';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import {
  clearClickTracking,
  selectSelectedAssets,
  selectShiftHoverPreview,
  setShiftHoverAssetId,
} from '@/app/store/selection';
import { Asset } from '@/app/tagging/components/asset/asset';
import {
  getCategoryAnchorId,
  groupAssetsByCategory,
} from '@/app/tagging/utils/category-utils';
import { scrollToAnchor } from '@/app/tagging/utils/scroll-to-anchor';
import { useAnchorScrolling } from '@/app/tagging/utils/use-anchor-scrolling';

// Define interface for asset with pagination index
interface AssetWithPaginationIndex extends ImageAsset {
  paginatedIndex: number;
  filteredIndex: number; // 1-based position in full filtered list
}

type AssetListProps = {
  currentPage?: number;
};

export const AssetList = ({ currentPage = 1 }: AssetListProps) => {
  // Handle anchor scrolling for cross-page navigation
  useAnchorScrolling();

  const dispatch = useAppDispatch();

  // Track whether shift key is currently held
  const [isShiftHeld, setIsShiftHeld] = useState(false);
  // Track currently hovered asset (using ref to avoid re-renders on hover)
  const hoveredAssetRef = useRef<string | null>(null);

  // Clear shift-click tracking when page changes
  useEffect(() => {
    dispatch(clearClickTracking());
  }, [currentPage, dispatch]);

  // Track shift key state globally
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && !isShiftHeld) {
        setIsShiftHeld(true);
        // If already hovering an asset when shift is pressed, update Redux
        if (hoveredAssetRef.current) {
          dispatch(setShiftHoverAssetId(hoveredAssetRef.current));
        }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setIsShiftHeld(false);
        dispatch(setShiftHoverAssetId(null));
      }
    };
    // Also clear on blur (window loses focus)
    const handleBlur = () => {
      setIsShiftHeld(false);
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
  }, [dispatch, isShiftHeld]);

  // Get pagination size from Redux
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

  // Handler for asset hover - always track in ref, dispatch to Redux only if shift is held
  const handleAssetHover = useCallback(
    (assetId: string | null) => {
      hoveredAssetRef.current = assetId;
      if (isShiftHeld) {
        dispatch(setShiftHoverAssetId(assetId));
      }
    },
    [dispatch, isShiftHeld],
  );

  // Group assets by sort category. The shared helper is the single source of
  // truth for display order, so the shift-select range below matches the render.
  const groupedAssets = useMemo(() => {
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

  // Check if there's only one category to hide headers
  const showCategoryHeaders = groupedAssets.length > 1;

  // Memoize rendered assets to prevent unnecessary re-renders
  const renderedAssets = useMemo(
    () =>
      groupedAssets.map(({ category, assets }) => {
        const anchorId = getCategoryAnchorId(category);

        return (
          <div key={category} className="asset-group">
            {showCategoryHeaders ? (
              <div
                id={anchorId}
                className="sticky top-24 z-10 -mx-2 cursor-pointer scroll-mt-24 rounded-sm border-b border-b-slate-700/80 bg-slate-500/60 px-4 py-1 text-sm font-medium text-white backdrop-blur-md transition-colors text-shadow-slate-700 text-shadow-xs hover:bg-slate-600/70 dark:bg-slate-600/60"
                onClick={() => scrollToAnchor(anchorId)}
                title="Click to scroll to top of this section"
              >
                {category}
              </div>
            ) : (
              // Still provide anchor ID for single category case, but invisible
              <div id={anchorId} className="scroll-mt-24" />
            )}

            {assets.map((asset) => {
              // Determine preview state for this asset
              const previewState = shiftHoverPreview?.previewAssetIds.has(
                asset.fileId,
              )
                ? shiftHoverPreview.previewAction
                : null;

              return (
                <Asset
                  key={asset.fileId}
                  assetId={asset.fileId}
                  filteredIndex={asset.filteredIndex}
                  fileExtension={asset.fileExtension}
                  subfolder={asset.subfolder}
                  dimensions={asset.dimensions}
                  bucket={asset.bucket}
                  ioState={asset.ioState}
                  lastModified={asset.lastModified}
                  blurDataUrl={asset.blurDataUrl}
                  currentPage={currentPage}
                  previewState={previewState}
                  onHover={handleAssetHover}
                />
              );
            })}
          </div>
        );
      }),
    [
      groupedAssets,
      showCategoryHeaders,
      currentPage,
      shiftHoverPreview,
      handleAssetHover,
    ],
  );

  return filteredAssets.length ? (
    renderedAssets
  ) : (
    <div className="flex flex-col items-center justify-center p-8 text-center text-slate-500">
      <BoxSelectIcon className="h-24 w-24" />
      <h1 className="mt-4 mb-4 w-full text-xl">
        No results match your filters
      </h1>
    </div>
  );
};
