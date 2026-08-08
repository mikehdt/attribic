import { useMemo } from 'react';

import { Asset } from '@/app/tagging/components/asset/asset';

import { CategoryHeader } from './category-header';
import type { GroupedAssets, ShiftHoverPreview } from './use-asset-gallery';

type AssetListProps = {
  groupedAssets: GroupedAssets;
  showCategoryHeaders: boolean;
  currentPage: number;
  shiftHoverPreview: ShiftHoverPreview;
  onAssetHover: (assetId: string | null) => void;
};

/** The full-detail row renderer: image, inline tag editor and metadata. */
export const AssetList = ({
  groupedAssets,
  showCategoryHeaders,
  currentPage,
  shiftHoverPreview,
  onAssetHover,
}: AssetListProps) => {
  // Memoize rendered assets to prevent unnecessary re-renders
  const renderedAssets = useMemo(
    () =>
      groupedAssets.map(({ category, assets }) => (
        <div key={category} className="asset-group mb-6">
          <CategoryHeader category={category} visible={showCategoryHeaders} />

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
                onHover={onAssetHover}
              />
            );
          })}
        </div>
      )),
    [
      groupedAssets,
      showCategoryHeaders,
      currentPage,
      shiftHoverPreview,
      onAssetHover,
    ],
  );

  return <>{renderedAssets}</>;
};
