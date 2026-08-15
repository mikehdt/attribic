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

  // A scope counts only when it exists *and* is ticked — the checkbox is the
  // single source of truth, even when it's the only one on screen
  const useSelected = hasSelectedAssets && applyToSelectedAssets;
  const useFiltered = hasActiveFilters && applyToAssetsWithActiveFilters;

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
  // Only ticks seed the selected scope. A highlight is transient — it moves as
  // you look around — so merely having looked at an asset must not arm a scope,
  // whether that would narrow "add to everything I filtered" down to one asset
  // or quietly make that one asset the whole target. It still counts towards
  // the scope once the box is ticked, like any other soft selection.
  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional form initialization on modal open
      setApplyToSelectedAssets(tickedAssetsCount > 0);
      setApplyToAssetsWithActiveFilters(hasActiveFilters);
    }
  }, [isOpen, tickedAssetsCount, hasActiveFilters]);

  const handleSubmit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (tags.length === 0) return;

    if (hasInvalidConstraints) return;

    const validTags = tags.filter((tag) => {
      const tagInfo = memoizedTagsStatus.find((t) => t.tag === tag);
      return !tagInfo || tagInfo.status !== 'all';
    });

    if (validTags.length > 1 && onAddMultipleTags) {
      onAddMultipleTags(validTags, addToStart, useSelected, useFiltered);
    } else {
      const tagsToProcess = addToStart ? [...validTags].reverse() : validTags;

      tagsToProcess.forEach((tag) => {
        onAddTag(tag, addToStart, useSelected, useFiltered);
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

  // A scope exists but none of them is ticked — including the lone-checkbox
  // case, where nothing ticked means nothing chosen rather than "everything"
  const hasInvalidConstraints =
    (hasSelectedAssets || hasActiveFilters) && !useSelected && !useFiltered;

  // Calculate the effective asset count that would be affected
  const effectiveAssetCount = (() => {
    if (useSelected && useFiltered) return intersectionCount;
    if (useSelected) return selectedAssetsCount;
    if (useFiltered) return assetsWithActiveFiltersCount;
    return 0;
  })();

  const hasNoAffectedAssets = effectiveAssetCount === 0;
  const isFormInvalid =
    hasNoValidTags || hasInvalidConstraints || hasNoAffectedAssets;

  // Calculate the summary message
  const getSummaryMessage = () => {
    if (useSelected && useFiltered) {
      return `Tags will be added to ${intersectionCount} ${intersectionCount === 1 ? 'asset that is' : 'assets that are'} both selected and ${intersectionCount === 1 ? 'matches' : 'match'} active filters.`;
    }
    if (useSelected) {
      return `Tags will be added to the ${selectedAssetsCount} selected ${selectedAssetsCount === 1 ? 'asset' : 'assets'}.`;
    }
    if (useFiltered) {
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
