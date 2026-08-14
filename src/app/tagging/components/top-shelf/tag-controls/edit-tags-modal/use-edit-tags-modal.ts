import { useCallback, useEffect, useMemo, useState } from 'react';

import type { RootState } from '@/app/store';
import { selectAllImages, selectFilteredAssets } from '@/app/store/assets';
import {
  FilterMode,
  selectFilterMode,
  selectHasActiveFilters,
  selectHasNonTagFilters,
} from '@/app/store/filters';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import {
  selectWorkingSelection,
  selectWorkingSelectionCount,
} from '@/app/store/selection';
import {
  selectDuplicateTagInfo,
  selectTagCoExistence,
} from '@/app/store/selection/combinedSelectors';
import { editTagsAcrossAssets } from '@/app/store/selection/thunks';

import { processTagUpdatesWithDuplicateHandling } from './utils';

export const useEditTagsModal = (
  isOpen: boolean,
  onClose: () => void,
  filterTags: string[],
) => {
  const dispatch = useAppDispatch();

  // State for edited tags and UI
  const [editedTags, setEditedTags] = useState<Record<string, string>>(() => {
    return filterTags.reduce(
      (acc, tag) => {
        acc[tag] = tag;
        return acc;
      },
      {} as Record<string, string>,
    );
  });

  // State for the "only apply to filtered assets" checkbox
  const [onlyFilteredAssets, setOnlyFilteredAssets] = useState(true);

  // State for the "only apply to selected assets" checkbox
  const [onlySelectedAssets, setOnlySelectedAssets] = useState(false);

  // Get assets for the checkbox logic and scoping
  const allImages = useAppSelector(selectAllImages);
  const filteredAssets = useAppSelector(selectFilteredAssets);
  const hasActiveFilters = useAppSelector(selectHasActiveFilters);
  const hasNonTagFilters = useAppSelector(selectHasNonTagFilters);
  const filterMode = useAppSelector(selectFilterMode);
  // The scope box defaults off here, so the soft-selected highlight only ever
  // joins the scope after the user ticks it
  const selectedAssets = useAppSelector(selectWorkingSelection);
  const selectedAssetsCount = useAppSelector(selectWorkingSelectionCount);
  const hasSelectedAssets = selectedAssetsCount > 0;

  // In SHOW_ALL or MATCH_ANY mode with only tag filters active, scoping to
  // filtered assets is redundant — the filtered set already contains exactly
  // the assets that have these tags, which is the same set the rename affects.
  const isFilteredScopeMeaningful =
    hasActiveFilters &&
    (hasNonTagFilters ||
      (filterMode !== FilterMode.SHOW_ALL &&
        filterMode !== FilterMode.MATCH_ANY));

  // Compute the effective scoped asset IDs based on checkbox state
  const scopedAssetIds = useMemo(() => {
    const useFiltered = onlyFilteredAssets && hasActiveFilters;
    const useSelected = onlySelectedAssets && hasSelectedAssets;

    if (useFiltered && useSelected) {
      const filteredIds = new Set(filteredAssets.map((a) => a.fileId));
      return selectedAssets.filter((id) => filteredIds.has(id));
    } else if (useFiltered) {
      return filteredAssets.map((a) => a.fileId);
    } else if (useSelected) {
      return selectedAssets;
    }
    return allImages.map((a) => a.fileId);
  }, [
    onlyFilteredAssets,
    hasActiveFilters,
    onlySelectedAssets,
    hasSelectedAssets,
    filteredAssets,
    selectedAssets,
    allImages,
  ]);

  // Filter the filterTags to only show tags that exist on assets in scope
  const scopedFilterTags = useMemo(() => {
    const scopedIds = new Set(scopedAssetIds);
    const scopedImages = allImages.filter((img) => scopedIds.has(img.fileId));

    const tagsInScope = new Set<string>();
    scopedImages.forEach((img) => {
      img.tagList.forEach((tag) => {
        if (filterTags.includes(tag)) {
          tagsInScope.add(tag);
        }
      });
    });

    return filterTags.filter((tag) => tagsInScope.has(tag));
  }, [filterTags, scopedAssetIds, allImages]);

  // Create a memoized selector for computing tag status info
  const tagsStatusSelector = useMemo(
    () => (state: RootState) => {
      if (Object.keys(editedTags).length === 0) return {};

      const result: Record<
        string,
        {
          isDuplicate: boolean;
          isAllDuplicates: boolean;
          duplicateCount: number;
          totalSelected: number;
          wouldCreateDuplicates?: boolean;
          assetsWithBothTags?: number;
          assetsWithOriginalTag?: number;
        }
      > = {};

      Object.entries(editedTags).forEach(([originalTag, newValue]) => {
        if (!newValue || originalTag === newValue || newValue.trim() === '') {
          result[originalTag] = {
            isDuplicate: false,
            isAllDuplicates: false,
            duplicateCount: 0,
            totalSelected: 0,
            wouldCreateDuplicates: false,
            assetsWithBothTags: 0,
            assetsWithOriginalTag: 0,
          };
          return;
        }

        const duplicateInfo = selectDuplicateTagInfo(newValue)(state);
        const coExistenceInfo = selectTagCoExistence(
          originalTag.trim(),
          newValue.trim(),
        )(state);

        result[originalTag] = {
          ...duplicateInfo,
          ...coExistenceInfo,
        };
      });

      return result;
    },
    [editedTags],
  );

  const memoizedTagsStatus = useAppSelector(
    tagsStatusSelector,
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );

  // Reset the form when the modal opens
  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional form initialization on modal open
      setOnlyFilteredAssets(isFilteredScopeMeaningful);
      setOnlySelectedAssets(hasSelectedAssets);
    }
  }, [isOpen, isFilteredScopeMeaningful, hasSelectedAssets]);

  // Update editedTags when scopedFilterTags change (due to scope checkbox changes)
  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional form update when scope changes
      setEditedTags((prev) => {
        const newEditedTags: Record<string, string> = {};
        scopedFilterTags.forEach((tag) => {
          newEditedTags[tag] = prev[tag] !== undefined ? prev[tag] : tag;
        });
        return newEditedTags;
      });
    }
  }, [isOpen, scopedFilterTags]);

  // Handle tag value change for a specific tag
  const handleTagChange = useCallback(
    (originalTag: string, newValue: string) => {
      const safeValue = newValue || '';
      setEditedTags((prev) => ({
        ...prev,
        [originalTag]: safeValue,
      }));
    },
    [],
  );

  // Helper function to determine tag status based on duplicate info
  const getTagStatus = useCallback(
    (originalTag: string): 'none' | 'some' | 'all' | 'duplicate' => {
      const tagInfo = memoizedTagsStatus[originalTag];
      const newValue = editedTags[originalTag];

      if (!newValue || originalTag === newValue || newValue.trim() === '') {
        return 'none';
      }

      const trimmedValue = newValue.trim();

      const duplicateCount = Object.entries(editedTags).filter(
        ([otherTag, otherValue]) =>
          otherTag !== originalTag &&
          otherValue &&
          otherValue.trim() === trimmedValue,
      ).length;

      const hasFormDuplicates = duplicateCount > 0;

      if (tagInfo?.wouldCreateDuplicates) {
        const allAssetsWouldHaveDuplicates =
          tagInfo.assetsWithBothTags === tagInfo.assetsWithOriginalTag;

        if (allAssetsWouldHaveDuplicates) {
          return 'all';
        } else {
          return 'some';
        }
      }

      if (hasFormDuplicates) {
        return 'duplicate';
      }

      const isAnyOriginalTag = scopedFilterTags.some(
        (tag) => tag !== originalTag && tag === trimmedValue,
      );

      if (isAnyOriginalTag) {
        return 'duplicate';
      }

      if (tagInfo?.isDuplicate) {
        return tagInfo.isAllDuplicates ? 'all' : 'some';
      }

      return 'none';
    },
    [memoizedTagsStatus, editedTags, scopedFilterTags],
  );

  // Submit the form
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      const processedUpdates = processTagUpdatesWithDuplicateHandling(
        editedTags,
        scopedFilterTags,
        getTagStatus,
      );

      if (processedUpdates.length === 0) {
        onClose();
        return;
      }

      dispatch(
        editTagsAcrossAssets({
          tagUpdates: processedUpdates,
          onlyFilteredAssets: onlyFilteredAssets && hasActiveFilters,
          onlySelectedAssets: onlySelectedAssets && hasSelectedAssets,
        }),
      );

      onClose();
    },
    [
      dispatch,
      editedTags,
      scopedFilterTags,
      getTagStatus,
      onClose,
      onlyFilteredAssets,
      hasActiveFilters,
      onlySelectedAssets,
      hasSelectedAssets,
    ],
  );

  // Check if any tags have been modified
  const hasModifiedTags = Object.entries(editedTags).some(
    ([originalTag, newTag]) => {
      if (!newTag || originalTag === newTag || newTag.trim() === '') {
        return false;
      }
      const status = getTagStatus(originalTag);
      return status !== 'all';
    },
  );

  // Calculate the effective asset count that would be affected
  // Reuses scopedAssetIds which already computes the same filtered/selected intersection
  const useFiltered = onlyFilteredAssets && hasActiveFilters;
  const useSelected = onlySelectedAssets && hasSelectedAssets;
  const effectiveAssetCount =
    useFiltered || useSelected ? scopedAssetIds.length : -1;

  const hasNoAffectedAssets = effectiveAssetCount === 0;

  // Pre-compute all tag statuses once for use in the UI
  const tagStatuses = scopedFilterTags.map((tag) => ({
    tag,
    status: getTagStatus(tag),
  }));

  const hasStatusSome = tagStatuses.some((item) => item.status === 'some');
  const hasStatusAll = tagStatuses.some((item) => item.status === 'all');
  const hasStatusFormDuplicate = tagStatuses.some(
    (item) => item.status === 'duplicate',
  );

  // Calculate the summary message for how many assets will be affected
  const getSummaryMessage = () => {
    if (useFiltered && useSelected) {
      const count = scopedAssetIds.length;
      return `Tag changes will apply to ${count} ${count === 1 ? 'asset that is' : 'assets that are'} both filtered and selected.`;
    } else if (useFiltered) {
      const count = scopedAssetIds.length;
      return `Tag changes will apply to the ${count} currently filtered ${count === 1 ? 'asset' : 'assets'}.`;
    } else if (useSelected) {
      return `Tag changes will apply to the ${selectedAssetsCount} selected ${selectedAssetsCount === 1 ? 'asset' : 'assets'}.`;
    }
    return 'Tag changes will apply to all assets that have these tags.';
  };

  return {
    // Scoping state
    isFilteredScopeMeaningful,
    filteredAssets,
    selectedAssetsCount,
    hasSelectedAssets,
    onlyFilteredAssets,
    setOnlyFilteredAssets,
    onlySelectedAssets,
    setOnlySelectedAssets,

    // Tag data
    editedTags,
    scopedFilterTags,
    memoizedTagsStatus,
    tagStatuses,

    // Status flags
    hasModifiedTags,
    hasNoAffectedAssets,
    hasStatusSome,
    hasStatusAll,
    hasStatusFormDuplicate,

    // Handlers
    handleTagChange,
    handleSubmit,

    // Display
    getSummaryMessage,
  };
};
