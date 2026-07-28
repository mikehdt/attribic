import { memo } from 'react';

import {
  selectFilteredAssetsCount,
  selectImageCount,
} from '@/app/store/assets';
import { selectHasActiveVisibility } from '@/app/store/filters';
import { useAppSelector } from '@/app/store/hooks';
import { selectSelectedAssetsCount } from '@/app/store/selection';

const AssetCountsComponent = () => {
  const filteredCount = useAppSelector(selectFilteredAssetsCount);
  const visibilityActive = useAppSelector(selectHasActiveVisibility);
  const allAssetsCount = useAppSelector(selectImageCount);
  const selectedAssetsCount = useAppSelector(selectSelectedAssetsCount);

  return (
    <div className="flex items-center gap-2 text-sm font-medium tabular-nums">
      <div className="flex items-center gap-1">
        <span className="text-(--foreground)">{allAssetsCount}</span>
        <span className="text-(--unselected-text)">images total</span>
      </div>

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
