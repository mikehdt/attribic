import { Grid2x2PlusIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { Button } from '@/app/shared/button';
import {
  selectFilteredAssets,
  selectUnarchivedImageCount,
} from '@/app/store/assets';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import {
  selectMultipleAssets,
  selectSelectedAssetsSet,
} from '@/app/store/selection';

export const SelectAllButton = () => {
  const dispatch = useAppDispatch();

  const selectedAssetsSet = useAppSelector(selectSelectedAssetsSet);
  const filteredAssets = useAppSelector(selectFilteredAssets);
  // Archive-exclusive total: with the archive hidden (the default), showing
  // every unarchived asset should still read as "Select All"
  const allAssetsCount = useAppSelector(selectUnarchivedImageCount);

  // Ref for filteredAssets — keeps handleAddAllToSelection callback stable
  const filteredAssetsRef = useRef(filteredAssets);
  useEffect(() => {
    filteredAssetsRef.current = filteredAssets;
  });

  // Check if all currently filtered assets are selected (O(1) Set lookups)
  const allFilteredAssetsSelected = useMemo(() => {
    if (filteredAssets.length === 0) return true;
    return filteredAssets.every((asset) => selectedAssetsSet.has(asset.fileId));
  }, [filteredAssets, selectedAssetsSet]);

  const handleAddAllToSelection = useCallback(() => {
    const assetIds = filteredAssetsRef.current.map((asset) => asset.fileId);
    dispatch(selectMultipleAssets(assetIds));
  }, [dispatch]);

  const isShowingAllAssets = filteredAssets.length === allAssetsCount;

  return (
    <Button
      type="button"
      onClick={handleAddAllToSelection}
      disabled={allFilteredAssetsSelected || filteredAssets.length === 0}
      variant="ghost"
      color="slate"
      size="toolbar"
      title={
        allFilteredAssetsSelected
          ? 'All filtered assets already selected'
          : isShowingAllAssets
            ? 'Add all assets to selection'
            : 'Add all filtered assets to selection'
      }
    >
      <Grid2x2PlusIcon />
      <span className="max-xl:hidden">
        {isShowingAllAssets ? 'Select All' : 'Select Filtered'}
      </span>
    </Button>
  );
};
