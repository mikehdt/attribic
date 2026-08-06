import { ListXIcon } from 'lucide-react';
import { useCallback } from 'react';

import { Button } from '@/app/shared/button';
import { clearSelections, selectHasActiveFilters } from '@/app/store/filters';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';

export const ClearSelectionsButton = () => {
  const dispatch = useAppDispatch();

  const hasSelections = useAppSelector(selectHasActiveFilters);

  const handleClearSelections = useCallback(
    () => dispatch(clearSelections()),
    [dispatch],
  );

  return (
    <Button
      variant="ghost"
      type="button"
      onClick={handleClearSelections}
      disabled={!hasSelections}
      ghostDisabled={!hasSelections}
      size="toolbar"
      title="Clear selections (tags, sizes, files)"
    >
      <ListXIcon />
    </Button>
  );
};
