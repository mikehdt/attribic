import { createAsyncThunk } from '@reduxjs/toolkit';

import { groupAssetsByCategory } from '@/app/tagging/utils/category-utils';

import {
  addMultipleTags,
  deleteTag,
  editTag,
  markFilterTagsToDelete,
  selectFilteredAssets,
  selectSortDirection,
  selectSortType,
  SortType,
} from '../assets';
import { updateTagFilters } from '../filters';
import { selectPaginationSize } from '../filters';
import { type AppThunk, RootState } from '../index';
import { selectAssetsWithActiveFilters } from './combinedSelectors';
import {
  setAssetsSelectionState,
  toggleAssetSelection,
  trackAssetClick,
} from './reducers';
import { selectLastClickAction, selectLastClickedAssetId } from './selectors';

/**
 * Thunk action to edit multiple tags in all filtered assets
 * This enables bulk editing of tags across all assets that have those tags
 */
export const editTagsAcrossAssets = createAsyncThunk(
  'selection/editTagsAcrossAssets',
  async (
    {
      tagUpdates,
      onlyFilteredAssets = false,
      onlySelectedAssets = false,
    }: {
      tagUpdates: Array<{
        oldTagName: string;
        newTagName: string;
        operation: 'RENAME' | 'DELETE';
      }>;
      onlyFilteredAssets?: boolean;
      onlySelectedAssets?: boolean;
    },
    { getState, dispatch },
  ) => {
    const state = getState() as RootState;

    // Start with all assets or filtered assets based on the filter constraint
    let candidateAssets = onlyFilteredAssets
      ? selectFilteredAssets(state)
      : state.assets.images;

    // Further filter by selected assets if that constraint is active
    if (onlySelectedAssets) {
      const selectedAssetIds = new Set(state.selection.selectedAssets);
      candidateAssets = candidateAssets.filter((asset) =>
        selectedAssetIds.has(asset.fileId),
      );
    }

    // Validate the input
    if (!tagUpdates.length) {
      return {
        success: false,
        message: 'No tag updates provided',
      };
    }

    // For tracking modified assets
    const modifiedAssetCount: Record<string, number> = {};
    const tagsToDelete: string[] = [];

    // Create a snapshot of the original asset state to avoid interference between operations
    const originalAssetState = new Map(
      candidateAssets.map((asset) => [asset.fileId, [...asset.tagList]]),
    );

    // Track which assets have already had a tag renamed to each target name
    // This prevents multiple tags from being renamed to the same value in the same asset
    const assetRenamedTargets = new Map<string, Set<string>>();

    // Process each tag update
    tagUpdates.forEach(({ oldTagName, newTagName, operation }) => {
      // Skip empty or unchanged tags
      if (!newTagName.trim() || oldTagName === newTagName) {
        return;
      }

      if (operation === 'DELETE') {
        // For DELETE operations, check if this is a duplicate prevention delete
        // (when newTagName != oldTagName, it means this tag was intended to be renamed
        // but is being deleted due to duplicate detection)
        if (newTagName.trim() !== oldTagName) {
          // This is a duplicate prevention delete - handle it like a rename that creates duplicates
          candidateAssets.forEach((asset) => {
            if (asset.tagList.includes(oldTagName)) {
              dispatch(
                deleteTag({
                  assetId: asset.fileId,
                  tagName: oldTagName,
                }),
              );

              // Count modifications
              modifiedAssetCount[oldTagName] =
                (modifiedAssetCount[oldTagName] || 0) + 1;
            }
          });
        } else {
          // Regular delete operation - collect tags to be marked for deletion
          tagsToDelete.push(oldTagName);
        }
        return;
      }

      // Handle RENAME operations
      if (operation === 'RENAME') {
        const trimmedNewName = newTagName.trim();

        // Find all assets with this tag
        candidateAssets.forEach((asset) => {
          if (asset.tagList.includes(oldTagName)) {
            // Initialize tracking for this asset if needed
            if (!assetRenamedTargets.has(asset.fileId)) {
              assetRenamedTargets.set(asset.fileId, new Set());
            }
            const assetTargets = assetRenamedTargets.get(asset.fileId)!;

            // Check against the ORIGINAL asset state for existing duplicates
            const originalTags = originalAssetState.get(asset.fileId) || [];
            const originallyHadTarget = originalTags.includes(trimmedNewName);

            // Check if we've already renamed another tag to this target in this operation
            const alreadyRenamedToTarget = assetTargets.has(trimmedNewName);

            if (originallyHadTarget || alreadyRenamedToTarget) {
              // Mark the ORIGINAL tag for deletion, not the target
              dispatch(
                deleteTag({
                  assetId: asset.fileId,
                  tagName: oldTagName, // Mark the ORIGINAL tag for deletion, not the target
                }),
              );
            } else {
              dispatch(
                editTag({
                  assetId: asset.fileId,
                  oldTagName,
                  newTagName: trimmedNewName,
                }),
              );

              // Track that we've renamed a tag to this target in this asset
              assetTargets.add(trimmedNewName);
            }

            // Count modifications
            modifiedAssetCount[oldTagName] =
              (modifiedAssetCount[oldTagName] || 0) + 1;
          }
        });
      }
    });

    // Mark tags for deletion in bulk
    if (tagsToDelete.length > 0) {
      // Pass the scoped asset IDs so deletion only affects the assets we're operating on
      const assetIds = candidateAssets.map((asset) => asset.fileId);
      dispatch(markFilterTagsToDelete({ tags: tagsToDelete, assetIds }));

      // Count deletions - count assets that have each tag
      tagsToDelete.forEach((tagName) => {
        const assetsWithTag = candidateAssets.filter((asset) =>
          asset.tagList.includes(tagName),
        ).length;
        modifiedAssetCount[tagName] = assetsWithTag;
      });
    }

    // Create a summary of changes
    const totalChangedTags = Object.keys(modifiedAssetCount).length;
    const totalChangedAssets = Object.values(modifiedAssetCount).reduce(
      (sum, count) => sum + count,
      0,
    );

    // Also update the filter tags to keep the selection in sync with the edits
    if (totalChangedTags > 0) {
      // Pass all operations to updateTagFilters - both RENAME and DELETE operations need filter updates
      dispatch(updateTagFilters(tagUpdates));
    }

    return {
      success: totalChangedTags > 0,
      count: totalChangedAssets,
      message:
        totalChangedTags > 0
          ? `Updated ${totalChangedTags} tags across ${totalChangedAssets} assets`
          : 'No tags were changed',
    };
  },
);

/**
 * Thunk action to add tags to assets based on dual selection logic.
 * Supports adding to selected assets, assets with active filters/visibility, or both.
 * Optimized to avoid redundant DIRTY marking when adding multiple tags.
 */
export const addMultipleTagsToAssetsWithDualSelection = createAsyncThunk(
  'selection/addMultipleTagsToAssetsWithDualSelection',
  async (
    {
      tagNames,
      addToStart = false,
      applyToSelectedAssets = false,
      applyToAssetsWithActiveFilters = false,
    }: {
      tagNames: string[];
      addToStart?: boolean;
      applyToSelectedAssets?: boolean;
      applyToAssetsWithActiveFilters?: boolean;
    },
    { getState, dispatch },
  ) => {
    const state = getState() as RootState;

    if (!tagNames.length) {
      return { success: false, message: 'No tags provided' };
    }

    const cleanedTags = [
      ...new Set(
        tagNames.map((tag) => tag.trim()).filter((tag) => tag.length > 0),
      ),
    ];

    if (!cleanedTags.length) {
      return { success: false, message: 'No valid tags provided' };
    }

    let finalAssets: string[] = [];

    if (applyToSelectedAssets && applyToAssetsWithActiveFilters) {
      // Both constraints: intersection of selected assets and filtered assets
      const selectedAssets = state.selection.selectedAssets;
      const filteredAssets = selectAssetsWithActiveFilters(state);
      const filteredIds = new Set(filteredAssets.map((asset) => asset.fileId));
      finalAssets = selectedAssets.filter((assetId) =>
        filteredIds.has(assetId),
      );
    } else if (applyToSelectedAssets) {
      finalAssets = [...state.selection.selectedAssets];
    } else if (applyToAssetsWithActiveFilters) {
      finalAssets = selectAssetsWithActiveFilters(state).map(
        (asset) => asset.fileId,
      );
    }

    if (!finalAssets.length) {
      return { success: false, message: 'No assets available' };
    }

    finalAssets.forEach((assetId) => {
      dispatch(
        addMultipleTags({
          assetId,
          tagNames: cleanedTags,
          position: addToStart ? 'start' : 'end',
        }),
      );
    });

    return {
      success: true,
      count: finalAssets.length,
      tagCount: cleanedTags.length,
      message: `Added ${cleanedTags.length} tags to ${finalAssets.length} assets`,
    };
  },
);

/**
 * Thunk to handle asset click with shift-selection support.
 * If shift is held and there's a previous click, selects/deselects the range.
 * Otherwise, toggles the single asset and tracks it for future shift-clicks.
 */
export const handleAssetClick =
  ({
    assetId,
    isShiftHeld,
    currentPage,
  }: {
    assetId: string;
    isShiftHeld: boolean;
    currentPage: number;
  }): AppThunk =>
  (dispatch, getState) => {
    const state = getState();
    const lastClickedAssetId = selectLastClickedAssetId(state);
    const lastClickAction = selectLastClickAction(state);

    // Get current page's visible assets
    const filteredAssets = selectFilteredAssets(state);
    const paginationSize = selectPaginationSize(state);

    // Slice the current page from the filtered assets
    const pageAssets =
      paginationSize === -1 // -1 is PaginationSize.ALL
        ? filteredAssets
        : filteredAssets.slice(
            (currentPage - 1) * paginationSize,
            (currentPage - 1) * paginationSize + paginationSize,
          );

    // Range selection must run in DISPLAY order (category-grouped), not the raw
    // filtered order — otherwise the selected range won't match what's rendered.
    // Mirrors AssetList's grouping so both stay in lockstep.
    const sortType = selectSortType(state);
    const sortDirection = selectSortDirection(state);
    const selectedForGrouping =
      sortType === SortType.SELECTED ? state.selection.selectedAssets : [];

    const paginatedAssetIds = groupAssetsByCategory(
      pageAssets,
      sortType,
      sortDirection,
      selectedForGrouping,
    ).flatMap(({ assets }) => assets.map((a) => a.fileId));

    // If shift is held and we have a previous click on this page
    if (isShiftHeld && lastClickedAssetId && lastClickAction) {
      const lastIndex = paginatedAssetIds.indexOf(lastClickedAssetId);
      const currentIndex = paginatedAssetIds.indexOf(assetId);

      // Both assets must be on the current page for range selection
      if (lastIndex !== -1 && currentIndex !== -1) {
        // Get the range of assets between the two clicks (inclusive)
        const startIndex = Math.min(lastIndex, currentIndex);
        const endIndex = Math.max(lastIndex, currentIndex);
        const rangeAssetIds = paginatedAssetIds.slice(startIndex, endIndex + 1);

        // Apply the same action (select/deselect) as the last click
        dispatch(
          setAssetsSelectionState({
            assetIds: rangeAssetIds,
            selected: lastClickAction === 'select',
          }),
        );

        // Update tracking to the current click (maintaining the same action)
        dispatch(trackAssetClick({ assetId, action: lastClickAction }));
        return;
      }
    }

    // No shift or no valid previous click - do a normal toggle
    const isCurrentlySelected =
      state.selection.selectedAssets.includes(assetId);
    const newAction = isCurrentlySelected ? 'deselect' : 'select';

    dispatch(toggleAssetSelection(assetId));
    dispatch(trackAssetClick({ assetId, action: newAction }));
  };
