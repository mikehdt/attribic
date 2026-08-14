import { TagIcon } from 'lucide-react';
import { useCallback, useState } from 'react';

import { Button } from '@/app/shared/button';
import { selectAllAssetsTagless } from '@/app/store/assets';
import {
  selectHasActiveFilters,
  selectHasActiveNonArchiveVisibility,
} from '@/app/store/filters';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import {
  addMultipleTagsToAssetsWithDualSelection,
  clearSelection,
  selectWorkingSelectionCount,
} from '@/app/store/selection';
import { selectAssetsWithActiveFiltersCount } from '@/app/store/selection/combinedSelectors';

import { AddTagsModal } from './add-tags-modal/add-tags-modal';

export const AddTagsButton = () => {
  const dispatch = useAppDispatch();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const selectedAssetsCount = useAppSelector(selectWorkingSelectionCount);
  const hasActiveFilters = useAppSelector(selectHasActiveFilters);
  const hasActiveVisibility = useAppSelector(
    selectHasActiveNonArchiveVisibility,
  );
  const allAssetsTagless = useAppSelector(selectAllAssetsTagless);
  const assetsWithActiveFiltersCount = useAppSelector(
    selectAssetsWithActiveFiltersCount,
  );

  const hasActiveScope =
    hasActiveFilters || hasActiveVisibility || allAssetsTagless;
  const canAddTags = selectedAssetsCount > 0 || hasActiveScope;

  const openModal = useCallback(() => setIsModalOpen(true), []);
  const closeModal = useCallback(() => setIsModalOpen(false), []);

  const handleClearSelection = useCallback(
    () => dispatch(clearSelection()),
    [dispatch],
  );

  const handleAddTag = useCallback(
    (
      tag: string,
      addToStart = false,
      applyToSelectedAssets = false,
      applyToAssetsWithActiveFilters = false,
    ) => {
      dispatch(
        addMultipleTagsToAssetsWithDualSelection({
          tagNames: [tag],
          addToStart,
          applyToSelectedAssets,
          applyToAssetsWithActiveFilters,
        }),
      );
      setIsModalOpen(false);
    },
    [dispatch],
  );

  const handleAddMultipleTags = useCallback(
    (
      tags: string[],
      addToStart = false,
      applyToSelectedAssets = false,
      applyToAssetsWithActiveFilters = false,
    ) => {
      dispatch(
        addMultipleTagsToAssetsWithDualSelection({
          tagNames: tags,
          addToStart,
          applyToSelectedAssets,
          applyToAssetsWithActiveFilters,
        }),
      );
      setIsModalOpen(false);
    },
    [dispatch],
  );

  return (
    <>
      <Button
        type="button"
        onClick={openModal}
        disabled={!canAddTags}
        variant="ghost"
        color="slate"
        size="toolbar"
        title={
          selectedAssetsCount > 0 && hasActiveScope
            ? `Add tags to selected assets or assets with active filters`
            : selectedAssetsCount > 0
              ? `Add tags to ${selectedAssetsCount} selected assets`
              : hasActiveScope
                ? `Add tags to ${assetsWithActiveFiltersCount} filtered assets`
                : 'Select assets or apply filters to add new tags'
        }
      >
        <TagIcon />
        <span className="max-xl:hidden">Add</span>
      </Button>

      <AddTagsModal
        isOpen={isModalOpen}
        onClose={closeModal}
        onClearSelection={handleClearSelection}
        onAddTag={handleAddTag}
        onAddMultipleTags={handleAddMultipleTags}
      />
    </>
  );
};
