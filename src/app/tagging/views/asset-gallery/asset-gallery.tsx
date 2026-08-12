'use client';

import { BoxSelectIcon } from 'lucide-react';

import { Button } from '@/app/shared/button';
import { useAppSelector } from '@/app/store/hooks';
import { selectTaggingViewMode } from '@/app/store/preferences';

import { AssetGrid } from './asset-grid';
import { AssetList } from './asset-list';
import { useAssetGallery } from './use-asset-gallery';
import { useAssetHotkeys } from './use-asset-hotkeys';

type AssetGalleryProps = {
  currentPage?: number;
};

/**
 * The tagging gallery: one shared state model (filters, sort, pagination,
 * grouping, selection) with two interchangeable renderers. Switching views
 * changes how assets are presented, never which assets are shown.
 */
export const AssetGallery = ({ currentPage = 1 }: AssetGalleryProps) => {
  const viewMode = useAppSelector(selectTaggingViewMode);
  const {
    hasResults,
    groupedAssets,
    showCategoryHeaders,
    paginatedAssetIds,
    shiftHoverPreview,
    handleAssetHover,
    handleClearFilters,
  } = useAssetGallery(currentPage);

  useAssetHotkeys(paginatedAssetIds, currentPage);

  if (!hasResults) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center text-slate-500">
        <BoxSelectIcon className="h-24 w-24" />
        <h1 className="mt-4 mb-4 w-full text-xl">
          No results match your filters
        </h1>
        <Button onClick={handleClearFilters} size="md" width="xl">
          Clear filters
        </Button>
      </div>
    );
  }

  return viewMode === 'grid' ? (
    <AssetGrid
      groupedAssets={groupedAssets}
      showCategoryHeaders={showCategoryHeaders}
      currentPage={currentPage}
      paginatedAssetIds={paginatedAssetIds}
      shiftHoverPreview={shiftHoverPreview}
      onAssetHover={handleAssetHover}
    />
  ) : (
    <AssetList
      groupedAssets={groupedAssets}
      showCategoryHeaders={showCategoryHeaders}
      currentPage={currentPage}
      paginatedAssetIds={paginatedAssetIds}
      shiftHoverPreview={shiftHoverPreview}
      onAssetHover={handleAssetHover}
    />
  );
};
