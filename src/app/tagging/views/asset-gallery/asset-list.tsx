import { useMemo } from 'react';

import { Asset } from '@/app/tagging/components/asset/asset';

import { CategoryHeader } from './category-header';
import { focusAssetRowEditor } from './editor-focus';
import type { GroupedAssets, ShiftHoverPreview } from './use-asset-gallery';
import {
  type AssetNavAdapter,
  useAssetKeyboardNav,
} from './use-asset-keyboard-nav';
import { useClearCurrentOnBackgroundClick } from './use-background-click';

type AssetListProps = {
  groupedAssets: GroupedAssets;
  showCategoryHeaders: boolean;
  currentPage: number;
  paginatedAssetIds: string[];
  shiftHoverPreview: ShiftHoverPreview;
  onAssetHover: (assetId: string | null) => void;
};

// Tab lands in the current row's inline editor; there are no extra Escape
// layers, so the nav layer's own handling (clear current) applies directly
const listNavAdapter: AssetNavAdapter = {
  editorSelector: '[data-asset-editor]',
  onTabInto: focusAssetRowEditor,
};

/** The full-detail row renderer: image, inline tag editor and metadata. */
export const AssetList = ({
  groupedAssets,
  showCategoryHeaders,
  currentPage,
  paginatedAssetIds,
  shiftHoverPreview,
  onAssetHover,
}: AssetListProps) => {
  useAssetKeyboardNav(paginatedAssetIds, currentPage, listNavAdapter);
  useClearCurrentOnBackgroundClick();

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

  // The min-height holds the page at full height under a short list: 10rem is
  // the top and bottom shelf allowance StableLayout pads `main` by, so this
  // fills the space between them without ever adding scroll of its own
  return <div className="min-h-[calc(100vh-10rem)]">{renderedAssets}</div>;
};
