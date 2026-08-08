import { LayoutGridIcon, LayoutListIcon } from 'lucide-react';
import { memo, useCallback } from 'react';

import { SegmentedControl } from '@/app/shared/segmented-control/segmented-control';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import {
  selectTaggingViewMode,
  setTaggingViewMode,
  type TaggingViewMode,
} from '@/app/store/preferences';

const VIEW_OPTIONS = [
  { value: 'list' as const, label: 'List view', icon: <LayoutListIcon /> },
  { value: 'grid' as const, label: 'Grid view', icon: <LayoutGridIcon /> },
];

const ViewModeToggleComponent = () => {
  const dispatch = useAppDispatch();
  const viewMode = useAppSelector(selectTaggingViewMode);

  const handleChange = useCallback(
    (mode: TaggingViewMode) => {
      dispatch(setTaggingViewMode(mode));
    },
    [dispatch],
  );

  return (
    <SegmentedControl
      options={VIEW_OPTIONS}
      value={viewMode}
      onChange={handleChange}
      size="xs"
      iconOnly
    />
  );
};

export const ViewModeToggle = memo(ViewModeToggleComponent);
