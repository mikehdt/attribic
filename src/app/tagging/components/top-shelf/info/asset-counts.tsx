import { memo } from 'react';

import {
  selectArchivedCount,
  selectFilteredAssetsCount,
  selectUnarchivedImageCount,
} from '@/app/store/assets';
import {
  ArchiveViewMode,
  selectArchiveView,
  selectHasActiveNonArchiveVisibility,
} from '@/app/store/filters';
import { useAppSelector } from '@/app/store/hooks';
import { selectSelectedAssetsCount } from '@/app/store/selection';

const AssetCountsComponent = () => {
  const filteredCount = useAppSelector(selectFilteredAssetsCount);
  // Archive view alone doesn't count — the archived readout covers it
  const visibilityActive = useAppSelector(selectHasActiveNonArchiveVisibility);
  const allAssetsCount = useAppSelector(selectUnarchivedImageCount);
  const archivedCount = useAppSelector(selectArchivedCount);
  const archiveView = useAppSelector(selectArchiveView);
  const selectedAssetsCount = useAppSelector(selectSelectedAssetsCount);

  const showArchivedCount =
    archiveView !== ArchiveViewMode.HIDDEN && archivedCount > 0;

  return (
    <div className="flex items-center gap-2 text-sm font-medium tabular-nums">
      <div className="flex items-center gap-1">
        <span className="text-(--foreground)">{allAssetsCount}</span>
        <span className="text-(--unselected-text)">images total</span>
      </div>

      {showArchivedCount ? (
        <div className="flex items-center gap-1 border-l border-l-(--border) pl-2">
          <span className="text-amber-500">{archivedCount}</span>
          <span className="text-(--unselected-text)">archived</span>
        </div>
      ) : null}

      {visibilityActive ? (
        <div className="flex items-center gap-1 border-l border-l-(--border) pl-2">
          <span className="text-teal-500">{filteredCount}</span>
          <span className="text-(--unselected-text)">filtered</span>
        </div>
      ) : null}

      {selectedAssetsCount > 0 ? (
        <div className="flex items-center gap-1 border-l border-l-(--border) pl-2">
          <span className="text-purple-500">{selectedAssetsCount}</span>
          <span className="text-(--unselected-text)">selected</span>
        </div>
      ) : null}
    </div>
  );
};

export const AssetCounts = memo(AssetCountsComponent);
