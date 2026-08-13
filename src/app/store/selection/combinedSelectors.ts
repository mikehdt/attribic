import { createSelector } from '@reduxjs/toolkit';

import { composeDimensions } from '../../utils/helpers';
import { isArchiveSubfolder } from '../../utils/subfolder-utils';
import {
  type ImageAsset,
  selectAllAssetsTagless,
  selectAllImages,
  selectFilteredAssets,
} from '../assets';
import {
  selectFilterTags,
  selectHasActiveFilters,
  selectHasActiveNonArchiveVisibility,
} from '../filters';
import type { RootState } from '../index';
import { selectSelectedAssets, selectSelectedAssetsSet } from '../selection';

// Cache for memoized selectors - prevents creating new selector instances
const duplicateTagInfoCache = new Map<
  string,
  ReturnType<typeof createDuplicateTagInfoSelector>
>();
const tagCoExistenceCache = new Map<
  string,
  ReturnType<typeof createTagCoExistenceSelector>
>();

// Helper to create a cache key for tag co-existence (two tags)
const makeCoExistenceKey = (originalTag: string, newTagValue: string) =>
  `${originalTag}::${newTagValue}`;

/**
 * Creates the actual selector for duplicate tag info
 */
const createDuplicateTagInfoSelector = (tagName: string) =>
  createSelector(
    [selectSelectedAssetsSet, selectAllImages],
    (selectedSet, allImages) => {
      if (!tagName || selectedSet.size === 0) {
        return {
          isDuplicate: false,
          duplicateCount: 0,
          totalSelected: selectedSet.size,
          isAllDuplicates: false,
        };
      }

      // Find all selected assets in the assets slice (O(1) Set lookup per asset)
      const selectedImagesData = allImages.filter((img) =>
        selectedSet.has(img.fileId),
      );

      // Count how many assets already have this tag
      const duplicateCount = selectedImagesData.filter((img) =>
        img.tagList.includes(tagName),
      ).length;

      return {
        isDuplicate: duplicateCount > 0,
        duplicateCount,
        totalSelected: selectedImagesData.length,
        isAllDuplicates:
          duplicateCount === selectedImagesData.length && duplicateCount > 0,
      };
    },
  );

/**
 * Creates the actual selector for tag co-existence
 */
const createTagCoExistenceSelector = (
  originalTag: string,
  newTagValue: string,
) =>
  createSelector([selectAllImages], (allImages) => {
    if (!originalTag || !newTagValue || originalTag === newTagValue) {
      return {
        wouldCreateDuplicates: false,
        assetsWithOriginalTag: 0,
        assetsWithBothTags: 0,
      };
    }

    // Find all assets that have the original tag
    const assetsWithOriginalTag = allImages.filter((img) =>
      img.tagList.includes(originalTag),
    );

    // Count how many of those assets also have the new tag
    const assetsWithBothTags = assetsWithOriginalTag.filter((img) =>
      img.tagList.includes(newTagValue),
    );

    return {
      wouldCreateDuplicates: assetsWithBothTags.length > 0,
      assetsWithOriginalTag: assetsWithOriginalTag.length,
      assetsWithBothTags: assetsWithBothTags.length,
    };
  });

/**
 * Clears all parameterised selector caches.
 * Call on project switch to prevent stale selectors from accumulating.
 */
export const clearSelectorCaches = () => {
  duplicateTagInfoCache.clear();
  tagCoExistenceCache.clear();
};

/**
 * Returns a cached selector for duplicate tag info.
 * The same selector instance is returned for the same tagName,
 * enabling proper memoization.
 */
export const selectDuplicateTagInfo = (tagName: string) => {
  if (!duplicateTagInfoCache.has(tagName)) {
    duplicateTagInfoCache.set(tagName, createDuplicateTagInfoSelector(tagName));
  }
  return duplicateTagInfoCache.get(tagName)!;
};

/**
 * Returns a cached selector for tag co-existence.
 * The same selector instance is returned for the same tag pair,
 * enabling proper memoization.
 */
export const selectTagCoExistence = (
  originalTag: string,
  newTagValue: string,
) => {
  const key = makeCoExistenceKey(originalTag, newTagValue);
  if (!tagCoExistenceCache.has(key)) {
    tagCoExistenceCache.set(
      key,
      createTagCoExistenceSelector(originalTag, newTagValue),
    );
  }
  return tagCoExistenceCache.get(key)!;
};

/**
 * Selector to get assets that match any active filtering (filters or visibility scopes).
 * When visibility scopes are active (tagless, selected, modified), returns the
 * filtered view regardless of whether it narrows the result set.
 * When only explicit filter selections are active (without visibility modes),
 * returns assets matching any of the selections (union/OR logic).
 *
 * Archived assets are never in this set, and showing the archive is never what
 * puts a scope on it. Bulk actions read this to answer "which assets did the
 * user mean?", and merely having the archive on screen — which is what you do
 * to move something out of it — must not answer "all of them": a Move would
 * then sweep the whole gallery into one folder. Archived assets are reachable
 * by selecting them, which is the deliberate act this stands in for.
 */
export const selectAssetsWithActiveFilters = createSelector(
  [
    (state: RootState) => selectHasActiveFilters(state),
    (state: RootState) => selectHasActiveNonArchiveVisibility(state),
    selectAllAssetsTagless,
    selectFilteredAssets,
    selectAllImages,
    // Extract specific fields — avoids recomputation when unrelated filter
    // state changes (paginationSize, filterMode, visibility toggles)
    (state: RootState) => state.filters.filterTags,
    (state: RootState) => state.filters.filterExtensions,
    (state: RootState) => state.filters.filterSubfolders,
    (state: RootState) => state.filters.filterSizes,
    (state: RootState) => state.filters.filterBuckets,
    (state: RootState) => state.filters.filenamePatterns,
  ],
  (
    hasActiveFilters,
    hasActiveVisibility,
    allAssetsTagless,
    filteredAssets,
    allImages,
    filterTags,
    filterExtensions,
    filterSubfolders,
    filterSizes,
    filterBuckets,
    filenamePatterns,
  ) => {
    const unarchived = (assets: ImageAsset[]) =>
      assets.filter((asset) => !isArchiveSubfolder(asset.subfolder));

    if (!hasActiveFilters && !hasActiveVisibility) {
      // When every asset is tagless, treat it as an implicit Tagless scope
      // so Add Tags / Auto Tagger operate on the whole project without
      // forcing the user to tick a redundant filter first.
      if (allAssetsTagless) return unarchived(allImages);
      return [];
    }

    // When visibility scopes are active (tagless, selected, modified),
    // return the filtered view — even when all assets happen to match
    if (hasActiveVisibility) {
      return unarchived(filteredAssets);
    }

    // Only explicit filter selections (tags, sizes, etc.) — compute a union
    // match so scoped actions know which assets are targeted
    if (hasActiveFilters) {
      const tagSet = new Set(filterTags);
      const extSet = new Set(filterExtensions);
      const subSet = new Set(filterSubfolders);
      const sizeSet = new Set(filterSizes);
      const bucketSet = new Set(filterBuckets);

      return allImages.filter((img) => {
        if (isArchiveSubfolder(img.subfolder)) return false;
        if (tagSet.size > 0 && img.tagList.some((t) => tagSet.has(t)))
          return true;
        if (extSet.size > 0 && extSet.has(img.fileExtension)) return true;
        if (subSet.size > 0 && img.subfolder && subSet.has(img.subfolder))
          return true;
        if (sizeSet.size > 0 && sizeSet.has(composeDimensions(img.dimensions)))
          return true;
        if (
          bucketSet.size > 0 &&
          bucketSet.has(`${img.bucket.width}×${img.bucket.height}`)
        )
          return true;
        if (filenamePatterns.length > 0) {
          const lower = img.fileId.toLowerCase();
          if (filenamePatterns.some((p) => lower.includes(p))) return true;
        }
        return false;
      });
    }

    return [];
  },
);

/**
 * Selector to get the count of assets with active filters
 * @returns Number of assets that match at least one active filter criterion
 */
export const selectAssetsWithActiveFiltersCount = createSelector(
  [selectAssetsWithActiveFilters],
  (assetsWithActiveFilters) => assetsWithActiveFilters.length,
);

/**
 * Selector to get the full data for selected assets
 * @returns Array of ImageAsset objects for selected assets
 */
export const selectSelectedAssetsData = createSelector(
  [selectSelectedAssetsSet, selectAllImages],
  (selectedSet, allImages) => {
    if (selectedSet.size === 0) {
      return [];
    }

    return allImages.filter((img) => selectedSet.has(img.fileId));
  },
);

/**
 * Boolean-only view for menu enablement: recomputes when selection data
 * changes, but subscribers only re-render when the answer flips.
 */
export const selectNoSelectedAssetHasTags = createSelector(
  [selectSelectedAssetsData],
  (selectedAssets) => selectedAssets.every((a) => a.tagList.length === 0),
);

/**
 * Returns the effective asset IDs based on scoping priority:
 * 1. Selected assets visible in current filtered view (intersection)
 * 2. Filtered assets (if filters active)
 * 3. All assets
 *
 * This determines which assets tag actions (Delete, Gather) should operate on.
 */
export const selectEffectiveScopeAssetIds = createSelector(
  [selectSelectedAssets, selectFilteredAssets, selectAllImages],
  (selectedAssets, filteredAssets, allImages) => {
    // Get the intersection of selected and filtered (visible selected assets)
    const filteredIds = new Set(filteredAssets.map((a) => a.fileId));
    const visibleSelected = selectedAssets.filter((id) => filteredIds.has(id));

    if (visibleSelected.length > 0) {
      return visibleSelected;
    }
    if (filteredAssets.length > 0) {
      return filteredAssets.map((a) => a.fileId);
    }
    return allImages.map((a) => a.fileId);
  },
);

/**
 * Returns the count of assets that would be affected by delete toggle.
 * Only counts assets in scope that have at least one of the selected filter tags.
 */
export const selectDeleteToggleAffectedCount = createSelector(
  [selectEffectiveScopeAssetIds, selectAllImages, selectFilterTags],
  (effectiveIds, allImages, filterTags) => {
    if (filterTags.length === 0) return 0;
    const effectiveSet = new Set(effectiveIds);
    const filterTagsSet = new Set(filterTags);
    return allImages.filter(
      (img) =>
        effectiveSet.has(img.fileId) &&
        img.tagList.some((tag) => filterTagsSet.has(tag)),
    ).length;
  },
);
