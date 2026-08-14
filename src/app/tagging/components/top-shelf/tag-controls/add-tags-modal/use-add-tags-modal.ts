import { SyntheticEvent, useEffect, useMemo, useRef, useState } from 'react';

import type { RootState } from '@/app/store';
import {
  selectHasActiveFilters,
  selectHasActiveNonArchiveVisibility,
} from '@/app/store/filters';
import { useAppSelector } from '@/app/store/hooks';
import {
  selectAssetsWithActiveFilters,
  selectDuplicateTagInfo,
  selectSelectedAssetsCount,
  selectWorkingSelection,
  selectWorkingSelectionCount,
} from '@/app/store/selection';

type UseAddTagsModalParams = {
  isOpen: boolean;
  onClose: () => void;
  onAddTag: (
    tag: string,
    addToStart?: boolean,
    onlySelectedAssets?: boolean,
    onlyFilteredAssets?: boolean,
  ) => void;
  onAddMultipleTags?: (
    tags: string[],
    addToStart?: boolean,
    onlySelectedAssets?: boolean,
    onlyFilteredAssets?: boolean,
  ) => void;
  onClearSelection?: () => void;
};

export const useAddTagsModal = ({
  isOpen,
  onClose,
  onAddTag,
  onAddMultipleTags,
  onClearSelection,
}: UseAddTagsModalParams) => {
  const [tags, setTags] = useState<string[]>([]);
  const [keepSelection, setKeepSelection] = useState(false);
  const [addToStart, setAddToStart] = useState(false);

  // State for dual selection mode
  const [applyToSelectedAssets, setApplyToSelectedAssets] = useState(false);
  const [applyToAssetsWithActiveFilters, setApplyToAssetsWithActiveFilters] =
    useState(false);

  // Get data for dual selection logic
  const hasExplicitFilters = useAppSelector(selectHasActiveFilters);
  const hasActiveVisibility = useAppSelector(
    selectHasActiveNonArchiveVisibility,
  );
  const hasActiveFilters = hasExplicitFilters || hasActiveVisibility;
  const selectedAssets = useAppSelector(selectWorkingSelection);
  const assetsWithActiveFilters = useAppSelector(selectAssetsWithActiveFilters);
  const selectedAssetsCount = useAppSelector(selectWorkingSelectionCount);
  // Ticks alone seed the scope checkbox — see the initialisation effect below
  const tickedAssetsCount = useAppSelector(selectSelectedAssetsCount);

  const hasSelectedAssets = selectedAssetsCount > 0;
  const assetsWithActiveFiltersCount = assetsWithActiveFilters.length;

  // Calculate the intersection count for summary display
  const intersectionCount =
    hasSelectedAssets && hasActiveFilters
      ? assetsWithActiveFilters.filter((asset) =>
          selectedAssets.includes(asset.fileId),
        ).length
      : 0;

  // For duplicate checking in the input field
  const [checkTag, setCheckTag] = useState('');
  const pendingCheckTagRef = useRef('');

  // Get duplicate info for the current check tag (cached selector)
  const tagDuplicateInfo = useAppSelector(selectDuplicateTagInfo(checkTag));

  // Sync checkTag with pending value after render to avoid setState-during-render
  useEffect(() => {
    if (pendingCheckTagRef.current !== checkTag) {
      setCheckTag(pendingCheckTagRef.current);
    }
  }, [checkTag]);

  // Create a memoized selector for getting all tag statuses
  const tagsStatusSelector = useMemo(
    () => (state: RootState) =>
      tags.map((tag) => {
        const info = selectDuplicateTagInfo(tag)(state);
        let status: 'all' | 'some' | 'none' = 'none';
        if (info.isDuplicate) {
          status = info.isAllDuplicates ? 'all' : 'some';
        }
        return { tag, status };
      }),
    [tags],
  );

  // Get status for all tags
  const memoizedTagsStatus = useAppSelector(
    tagsStatusSelector,
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );

  // Reset the form state when modal is closed
  useEffect(() => {
    if (!isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional form reset on modal close
      setTags([]);
      setCheckTag('');
      pendingCheckTagRef.current = '';
    }
  }, [isOpen]);

  // Initialize checkboxes based on what selections are available.
  //
  // The soft-selected highlight counts towards the scope once it's ticked, but
  // it must not tick it: with filters active, merely having looked at an asset
  // would otherwise narrow "add to everything I filtered" down to that one
  // asset. It does seed the box when there's no filter scope to fall back on,
  // since the scope is mandatory here and the highlight is then all there is.
  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional form initialization on modal open
      setApplyToSelectedAssets(
        hasSelectedAssets && (tickedAssetsCount > 0 || !hasActiveFilters),
      );
      setApplyToAssetsWithActiveFilters(hasActiveFilters);
    }
  }, [isOpen, hasSelectedAssets, tickedAssetsCount, hasActiveFilters]);

  const handleSubmit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (tags.length === 0) return;

    if (
      hasSelectedAssets &&
      hasActiveFilters &&
      !applyToSelectedAssets &&
      !applyToAssetsWithActiveFilters
    ) {
      return;
    }

    const validTags = tags.filter((tag) => {
      const tagInfo = memoizedTagsStatus.find((t) => t.tag === tag);
      return !tagInfo || tagInfo.status !== 'all';
    });

    if (validTags.length > 1 && onAddMultipleTags) {
      onAddMultipleTags(
        validTags,
        addToStart,
        applyToSelectedAssets,
        applyToAssetsWithActiveFilters,
      );
    } else {
      const tagsToProcess = addToStart ? [...validTags].reverse() : validTags;

      tagsToProcess.forEach((tag) => {
        onAddTag(
          tag,
          addToStart,
          applyToSelectedAssets,
          applyToAssetsWithActiveFilters,
        );
      });
    }

    if (!keepSelection && onClearSelection) {
      onClearSelection();
    }
    onClose();
  };

  // Duplicate check function for the input field
  const handleDuplicateCheck = (tag: string) => {
    pendingCheckTagRef.current = tag;
    return tagDuplicateInfo;
  };

  // Determine if the form is submittable
  const validTags = tags.filter((tag) => {
    const status = memoizedTagsStatus.find((t) => t.tag === tag)?.status;
    return status !== 'all';
  });

  const hasNoValidTags = tags.length === 0 || validTags.length === 0;

  const hasInvalidConstraints =
    hasSelectedAssets &&
    hasActiveFilters &&
    !applyToSelectedAssets &&
    !applyToAssetsWithActiveFilters;

  // Calculate the effective asset count that would be affected
  const effectiveAssetCount = (() => {
    if (hasSelectedAssets && hasActiveFilters) {
      if (applyToSelectedAssets && applyToAssetsWithActiveFilters) {
        return intersectionCount;
      } else if (applyToSelectedAssets) {
        return selectedAssetsCount;
      } else if (applyToAssetsWithActiveFilters) {
        return assetsWithActiveFiltersCount;
      }
      return 0;
    } else if (hasSelectedAssets) {
      return selectedAssetsCount;
    } else if (hasActiveFilters) {
      return assetsWithActiveFiltersCount;
    }
    return 0;
  })();

  const hasNoAffectedAssets = effectiveAssetCount === 0;
  const isFormInvalid =
    hasNoValidTags || hasInvalidConstraints || hasNoAffectedAssets;

  // Calculate the summary message
  const getSummaryMessage = () => {
    if (hasSelectedAssets && hasActiveFilters) {
      if (applyToSelectedAssets && applyToAssetsWithActiveFilters) {
        return `Tags will be added to ${intersectionCount} ${intersectionCount === 1 ? 'asset that is' : 'assets that are'} both selected and ${intersectionCount === 1 ? 'matches' : 'match'} active filters.`;
      } else if (applyToSelectedAssets) {
        return `Tags will be added to the ${selectedAssetsCount} selected ${selectedAssetsCount === 1 ? 'asset' : 'assets'}.`;
      } else if (applyToAssetsWithActiveFilters) {
        return `Tags will be added to ${assetsWithActiveFiltersCount} ${assetsWithActiveFiltersCount === 1 ? 'asset' : 'assets'} with active filters.`;
      }
    } else if (hasSelectedAssets) {
      return `Tags will be added to the ${selectedAssetsCount} selected ${selectedAssetsCount === 1 ? 'asset' : 'assets'}.`;
    } else if (hasActiveFilters) {
      return `Tags will be added to ${assetsWithActiveFiltersCount} ${assetsWithActiveFiltersCount === 1 ? 'asset' : 'assets'} with active filters.`;
    }
    return '';
  };

  return {
    // Tag state
    tags,
    setTags,
    keepSelection,
    setKeepSelection,
    addToStart,
    setAddToStart,

    // Scoping state
    hasActiveFilters,
    assetsWithActiveFiltersCount,
    selectedAssetsCount,
    hasSelectedAssets,
    applyToSelectedAssets,
    setApplyToSelectedAssets,
    applyToAssetsWithActiveFilters,
    setApplyToAssetsWithActiveFilters,

    // Tag status
    memoizedTagsStatus,

    // Validation
    hasInvalidConstraints,
    hasNoAffectedAssets,
    isFormInvalid,

    // Handlers
    handleSubmit,
    handleDuplicateCheck,

    // Display
    getSummaryMessage,
  };
};
