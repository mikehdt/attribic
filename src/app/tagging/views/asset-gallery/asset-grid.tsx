import { useCallback, useMemo, useState } from 'react';

import { CategoryHeader } from './category-header';
import { GridCell } from './grid-cell';
import { GridSidebar } from './grid-sidebar';
import type { GroupedAssets, ShiftHoverPreview } from './use-asset-gallery';
import { useGridKeyboardNav } from './use-grid-keyboard-nav';

type AssetGridProps = {
  groupedAssets: GroupedAssets;
  showCategoryHeaders: boolean;
  currentPage: number;
  paginatedAssetIds: string[];
  shiftHoverPreview: ShiftHoverPreview;
  onAssetHover: (assetId: string | null) => void;
};

/**
 * The compact grid renderer: thumbnails for looking, culling and selecting,
 * with detail delegated to the inspector sidebar. Each category group gets its
 * own auto-fill grid under the shared sticky header — identical `minmax`
 * tracks at the same container width mean columns align across groups.
 */
export const AssetGrid = ({
  groupedAssets,
  showCategoryHeaders,
  currentPage,
  paginatedAssetIds,
  shiftHoverPreview,
  onAssetHover,
}: AssetGridProps) => {
  // Below lg the inspector column is gone; Tab summons it as an overlay
  // instead (no dialog semantics, so grid navigation keeps working under it)
  const [isInspectorOverlayOpen, setInspectorOverlayOpen] = useState(false);
  const closeInspectorOverlay = useCallback(
    () => setInspectorOverlayOpen(false),
    [],
  );

  useGridKeyboardNav(paginatedAssetIds, currentPage, {
    isOpen: isInspectorOverlayOpen,
    setOpen: setInspectorOverlayOpen,
  });

  const renderedGroups = useMemo(
    () =>
      groupedAssets.map(({ category, assets }) => (
        <div key={category} className="asset-group">
          <CategoryHeader category={category} visible={showCategoryHeaders} />

          <div className="my-2 grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
            {assets.map((asset) => {
              const previewState = shiftHoverPreview?.previewAssetIds.has(
                asset.fileId,
              )
                ? shiftHoverPreview.previewAction
                : null;

              return (
                <GridCell
                  key={asset.fileId}
                  assetId={asset.fileId}
                  filteredIndex={asset.filteredIndex}
                  fileExtension={asset.fileExtension}
                  dimensions={asset.dimensions}
                  lastModified={asset.lastModified}
                  blurDataUrl={asset.blurDataUrl}
                  currentPage={currentPage}
                  previewState={previewState}
                  onHover={onAssetHover}
                />
              );
            })}
          </div>
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

  return (
    <div className="flex gap-4">
      <div className="min-w-0 flex-1">{renderedGroups}</div>
      <GridSidebar
        isOverlayOpen={isInspectorOverlayOpen}
        onOverlayClose={closeInspectorOverlay}
      />
    </div>
  );
};
