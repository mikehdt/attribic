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
import {
  selectSelectedAssetsCount,
  selectSoftSelectionCount,
} from '@/app/store/selection';

const AssetCountsComponent = () => {
  const filteredCount = useAppSelector(selectFilteredAssetsCount);
  // Archive view alone doesn't count — the archived readout covers it
  const visibilityActive = useAppSelector(selectHasActiveNonArchiveVisibility);
  const allAssetsCount = useAppSelector(selectUnarchivedImageCount);
  const archivedCount = useAppSelector(selectArchivedCount);
  const archiveView = useAppSelector(selectArchiveView);
  const selectedAssetsCount = useAppSelector(selectSelectedAssetsCount);
  // The highlighted asset counts as a soft member of the selection, so show it
  // alongside the ticked count ("3+1") rather than folded into it
  const softSelectionCount = useAppSelector(selectSoftSelectionCount);

  const showArchivedCount =
    archiveView !== ArchiveViewMode.HIDDEN && archivedCount > 0;

  const selectionTitle =
    softSelectionCount > 0
      ? selectedAssetsCount > 0
        ? `${selectedAssetsCount} selected, plus the highlighted asset`
        : 'The highlighted asset'
      : undefined;

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

      {selectedAssetsCount > 0 || softSelectionCount > 0 ? (
        <div
          className="flex items-center gap-1 border-l border-l-(--border) pl-2"
          title={selectionTitle}
        >
          <span>
            {selectedAssetsCount > 0 ? (
              <span className="text-purple-500">{selectedAssetsCount}</span>
            ) : null}
            {selectedAssetsCount > 0 && softSelectionCount > 0 ? (
              <span className="text-(--unselected-text)">+</span>
            ) : null}
            {softSelectionCount > 0 ? (
              <span className="text-sky-500">{softSelectionCount}</span>
            ) : null}
          </span>
          <span className="text-(--unselected-text)">selected</span>
        </div>
      ) : null}
    </div>
  );
};

export const AssetCounts = memo(AssetCountsComponent);
