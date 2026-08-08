import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CategoryHeader } from './category-header';
import {
  isGridInspectorFocused,
  revealGridInspector,
} from './focus-grid-inspector';
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
  // Below lg the inspector column is gone; Tab (or a second click on the
  // inspected cell) summons it as an overlay instead — no dialog semantics,
  // so grid navigation keeps working under it
  const [isInspectorOverlayOpen, setInspectorOverlayOpen] = useState(false);
  const closeInspectorOverlay = useCallback(
    () => setInspectorOverlayOpen(false),
    [],
  );

  // Clicking a cell blurs the inspector as part of the pointer-down's default
  // action, before any click handler runs — so pointer-down is the last moment
  // the toggle below can tell whether the tagging UI was in use
  const wasInspectorFocusedRef = useRef(false);
  useEffect(() => {
    const trackInspectorFocus = () => {
      wasInspectorFocusedRef.current = isGridInspectorFocused();
    };
    window.addEventListener('mousedown', trackInspectorFocus, true);
    return () =>
      window.removeEventListener('mousedown', trackInspectorFocus, true);
  }, []);

  // Backing out only has to close the narrow-viewport overlay: the
  // pointer-down already took focus off the panel, which is all "out" means
  // at widths where the column is permanently visible
  const toggleInspector = useCallback(() => {
    if (wasInspectorFocusedRef.current) {
      setInspectorOverlayOpen(false);
      return;
    }
    revealGridInspector(setInspectorOverlayOpen);
  }, []);

  useGridKeyboardNav(paginatedAssetIds, currentPage, {
    isOpen: isInspectorOverlayOpen,
    setOpen: setInspectorOverlayOpen,
  });

  const renderedGroups = useMemo(
    () =>
      groupedAssets.map(({ category, assets }) => (
        <div key={category} className="asset-group mb-6">
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
                  subfolder={asset.subfolder}
                  dimensions={asset.dimensions}
                  lastModified={asset.lastModified}
                  blurDataUrl={asset.blurDataUrl}
                  currentPage={currentPage}
                  previewState={previewState}
                  onHover={onAssetHover}
                  onActivate={toggleInspector}
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
      toggleInspector,
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
