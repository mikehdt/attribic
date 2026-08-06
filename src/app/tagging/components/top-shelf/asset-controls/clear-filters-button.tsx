import { FunnelXIcon } from 'lucide-react';
import { useCallback } from 'react';

import { Button } from '@/app/shared/button';
import {
  clearVisibilityFilters,
  selectHasVisibilitySettings,
} from '@/app/store/filters';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';

export const ClearFiltersButton = () => {
  const dispatch = useAppDispatch();

  const canClear = useAppSelector(selectHasVisibilitySettings);

  const handleClearFilters = useCallback(
    () => dispatch(clearVisibilityFilters()),
    [dispatch],
  );

  return (
    <Button
      variant="ghost"
      type="button"
      onClick={handleClearFilters}
      disabled={!canClear}
      ghostDisabled={!canClear}
      size="toolbar"
      title="Clear filters (keeps selections)"
    >
      <FunnelXIcon />
    </Button>
  );
};
