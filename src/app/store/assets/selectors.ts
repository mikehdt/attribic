// Complex selectors for assets slice
import { createSelector, weakMapMemoize } from '@reduxjs/toolkit';

import { applyVisibilityFilters } from '../../utils/filter-actions';
import { composeDimensions } from '../../utils/helpers';
import { wrapSelector } from '../../utils/selector-perf';
import { isArchiveSubfolder } from '../../utils/subfolder-utils';
import type { RootState } from '../';
import { TagSortDirection, TagSortType } from '../project';
import type { CaptionMode } from '../project/types';
import { isAssetDirty } from './helpers';
import { ImageAsset, KeyedCountList, SortType, TagState } from './types';
import { buildTagCountsCache, hasState } from './utils';

// Base selector that extracts all images from RootState
// Note: This is a local version to avoid circular dependency with index.ts
// External consumers should use the slice selector from the main exports
const selectAllImages = (state: RootState) => state.assets.images;
const selectImageIndexById = (state: RootState) => state.assets.imageIndexById;
const selectTagCountsCache = (state: RootState) => state.assets.tagCountsCache;

// Selector that returns cached tag counts, rebuilding if cache is null
// This is the core of the caching strategy - counts are computed once and shared
// Exported for direct use by components that need global tag counts
export const selectTagCounts = wrapSelector(
  'selectTagCounts',
  createSelector([selectAllImages, selectTagCountsCache], (images, cache) => {
    // If cache exists, use it; otherwise rebuild
    // Note: The rebuilt cache is returned but not stored in state here
    // The cache is populated on load and invalidated on mutations
    if (cache !== null) {
      return cache;
    }
    return buildTagCountsCache(images);
  }),
);

// Derived selectors

// Plain function — returns boolean primitive so useSelector handles equality.
// No createSelector wrapper needed since parameterized selectors with cache
// size 1 always recompute when called from different components anyway.
// Covers both tag mode and caption mode modifications.
export const selectAssetHasModifiedTags = (
  state: RootState,
  assetId: string,
): boolean => {
  const images = selectAllImages(state);
  const indexById = selectImageIndexById(state);
  const asset = images[indexById[assetId]];
  if (!asset) return false;

  const captionMode = state.project.config.captionMode;

  return isAssetDirty(asset, captionMode);
};

// Plain O(1) lookup — returns the stored asset reference, so useSelector's
// equality check only fails when this asset's record actually changes
export const selectAssetById = (
  state: RootState,
  assetId: string,
): ImageAsset | undefined => {
  const images = selectAllImages(state);
  const indexById = selectImageIndexById(state);
  return images[indexById[assetId]];
};

// Plain selector for caption text — returns primitive string so useSelector handles equality
export const selectAssetCaptionText = (
  state: RootState,
  assetId: string,
): string => {
  const images = selectAllImages(state);
  const indexById = selectImageIndexById(state);
  return images[indexById[assetId]]?.captionText ?? '';
};

// Selectors for tag sorting from project store
const selectTagSortType = (state: RootState) =>
  state.project.config.tagSortType;
const selectTagSortDirection = (state: RootState) =>
  state.project.config.tagSortDirection;

// Result shape is compared field-by-field (see resultEqualityCheck below), so
// an asset record that changed for an unrelated reason — a caption keystroke —
// hands back the previous array and leaves the tag list unrendered.
const tagsWithStatusEqual = (
  a: { name: string; status: number }[],
  b: { name: string; status: number }[],
) =>
  a.length === b.length &&
  a.every((tag, i) => tag.name === b[i].name && tag.status === b[i].status);

export const selectOrderedTagsWithStatus = createSelector(
  // Input selectors. Keyed on the single asset rather than the whole `images`
  // array: every asset gets a new array reference on any mutation, so taking
  // the list here would recompute this for every mounted row on every edit.
  [
    selectAssetById,
    selectTagCounts,
    selectTagSortType,
    selectTagSortDirection,
  ],
  // Result function
  (selectedImage, tagCounts, sortType, sortDirection) => {
    if (!selectedImage) return [];

    // Create an array of objects with tag name and status
    const tagsWithStatus = selectedImage.tagList.map((tagName) => ({
      name: tagName,
      status: selectedImage.tagStatus[tagName] || TagState.SAVED,
    }));

    // Apply sorting based on sort type
    if (sortType === TagSortType.SORTABLE) {
      // Saved/drag order - already in correct order from tagList
      return tagsWithStatus;
    }

    // Sort the tags
    const sorted = [...tagsWithStatus].sort((a, b) => {
      let comparison = 0;

      if (sortType === TagSortType.ALPHABETICAL) {
        comparison = a.name.localeCompare(b.name);
      } else if (sortType === TagSortType.FREQUENCY) {
        const countA = tagCounts[a.name] || 0;
        const countB = tagCounts[b.name] || 0;
        comparison = countA - countB;
      }

      // Apply direction
      return sortDirection === TagSortDirection.ASC ? comparison : -comparison;
    });

    return sorted;
  },
  // weakMapMemoize caches per-argument-combination instead of a single slot,
  // preventing cache thrashing when multiple components call with different fileIds
  {
    memoize: weakMapMemoize,
    argsMemoize: weakMapMemoize,
    memoizeOptions: { resultEqualityCheck: tagsWithStatusEqual },
  },
);

export const selectImageSizes = createSelector([selectAllImages], (images) => {
  if (!images.length) return {};

  const counts: Record<string, number> = {};
  for (const item of images) {
    const dim = composeDimensions(item.dimensions);
    counts[dim] = (counts[dim] || 0) + 1;
  }
  return counts;
});

// Custom selector to check if any assets have modified tags or captions
export const selectHasModifiedAssets = wrapSelector(
  'selectHasModifiedAssets',
  createSelector(
    [selectAllImages, (state: RootState) => state.project.config.captionMode],
    (images, captionMode) => {
      return images.some((asset) => isAssetDirty(asset, captionMode));
    },
  ),
);

const isAssetTagless = (
  asset: ImageAsset,
  captionMode: CaptionMode,
): boolean => {
  // "Persisted tags" = tags present on disk (not pending add/delete).
  const hasNoPersistedTags = asset.tagList.every(
    (tag) =>
      hasState(asset.tagStatus[tag], TagState.TO_DELETE) ||
      hasState(asset.tagStatus[tag], TagState.TO_ADD),
  );
  const hasNoCaption = !asset.captionText?.trim();

  if (captionMode === 'caption') {
    return hasNoCaption;
  }
  if (captionMode === 'hybrid') {
    // Empty only when both sections are empty.
    return hasNoPersistedTags && hasNoCaption;
  }
  return hasNoPersistedTags;
};

// Custom selector to check if any assets have no persisted tags (or no caption text)
export const selectHasTaglessAssets = createSelector(
  [selectAllImages, (state: RootState) => state.project.config.captionMode],
  (images, captionMode) =>
    images.some((asset) => isAssetTagless(asset, captionMode)),
);

// True when every asset is tagless — used to enable tag actions implicitly
// so users don't need to click "Tagless only" on a fresh, untagged project.
export const selectAllAssetsTagless = createSelector(
  [selectAllImages, (state: RootState) => state.project.config.captionMode],
  (images, captionMode) =>
    images.length > 0 &&
    images.every((asset) => isAssetTagless(asset, captionMode)),
);

export const selectHasSubfolderAssets = createSelector(
  [selectAllImages],
  (images) => {
    // Check if any asset is in a subfolder (the archive isn't one)
    return images.some(
      (asset) =>
        asset.subfolder !== undefined && !isArchiveSubfolder(asset.subfolder),
    );
  },
);

export const selectArchivedCount = createSelector([selectAllImages], (images) =>
  images.reduce(
    (count, asset) => (isArchiveSubfolder(asset.subfolder) ? count + 1 : count),
    0,
  ),
);

export const selectHasArchivedAssets = createSelector(
  [selectArchivedCount],
  (archivedCount) => archivedCount > 0,
);

// The working-set total — archived assets sit outside it
export const selectUnarchivedImageCount = createSelector(
  [selectAllImages, selectArchivedCount],
  (images, archivedCount) => images.length - archivedCount,
);

// Using selectSaveProgress and selectLoadProgress from the slice

/**
 * Images per training bucket, keyed `"width×height"`. Memoised here (rather
 * than counted in the Buckets view's hook) so it recomputes when the asset list
 * changes instead of on every render of the panel — the same treatment sizes
 * get from `selectImageSizes`.
 */
export const selectBucketCounts = createSelector(
  [selectAllImages],
  (images) => {
    if (!images.length) return {};

    const counts: KeyedCountList = {};
    for (const item of images) {
      const bucket = `${item.bucket.width}×${item.bucket.height}`;
      counts[bucket] = (counts[bucket] || 0) + 1;
    }
    return counts;
  },
);

export const selectAllExtensions = createSelector(
  [selectAllImages],
  (images) => {
    if (!images.length) return {};

    // Group by file extension
    const extensionCounts: KeyedCountList = {};
    for (const item of images) {
      const extension = item.fileExtension.toLowerCase();
      extensionCounts[extension] = (extensionCounts[extension] || 0) + 1;
    }

    return extensionCounts;
  },
);

export const selectAllSubfolders = createSelector(
  [selectAllImages],
  (images) => {
    if (!images.length) return {};

    // Group by subfolder — the archive is a meta folder, not a filterable one
    const subfolderCounts: KeyedCountList = {};
    for (const item of images) {
      if (item.subfolder && !isArchiveSubfolder(item.subfolder)) {
        subfolderCounts[item.subfolder] =
          (subfolderCounts[item.subfolder] || 0) + 1;
      }
    }

    return subfolderCounts;
  },
);

// Returns selectedAssets only when filtering or sorting actually needs them.
// When scopeSelected is off and sort type isn't SELECTED, returns a stable
// empty array so selection changes don't trigger expensive recomputation.
const EMPTY_STRING_ARRAY: string[] = [];
const selectRelevantSelectedAssets = createSelector(
  [
    (state: RootState) => state.filters.visibility.scopeSelected,
    (state: RootState) => state.assets.sortType,
    (state: RootState) => state.selection.selectedAssets,
  ],
  (scopeSelected, sortType, selectedAssets) => {
    if (scopeSelected || sortType === SortType.SELECTED) {
      return selectedAssets;
    }
    return EMPTY_STRING_ARRAY;
  },
);

// Combined selector to get filtered assets based on current filter state
export const selectFilteredAssets = wrapSelector(
  'selectFilteredAssets',
  createSelector(
    [
      selectAllImages,
      (state: RootState) => state.filters.filterTags,
      (state: RootState) => state.filters.filterSizes,
      (state: RootState) => state.filters.filterBuckets,
      (state: RootState) => state.filters.filterExtensions,
      (state: RootState) => state.filters.filterSubfolders,
      (state: RootState) => state.filters.filenamePatterns,
      (state: RootState) => state.filters.visibility,
      selectRelevantSelectedAssets,
      (state: RootState) => state.assets.sortType,
      (state: RootState) => state.assets.sortDirection,
      (state: RootState) => state.project.config.captionMode,
      (state: RootState) => state.project.config.triggerPhrases,
    ],
    (
      assets,
      filterTags,
      filterSizes,
      filterBuckets,
      filterExtensions,
      filterSubfolders,
      filenamePatterns,
      visibility,
      selectedAssets,
      sortType,
      sortDirection,
      captionMode,
      triggerPhrases,
    ) => {
      return applyVisibilityFilters({
        assets,
        filterTags,
        filterSizes,
        filterBuckets,
        filterExtensions,
        filterSubfolders: filterSubfolders || [],
        filenamePatterns: filenamePatterns || [],
        visibility,
        selectedAssets,
        sortType,
        sortDirection,
        captionMode,
        triggerPhrases,
      });
    },
  ),
);

// Selector to analyze the TO_DELETE state of filter tags
// Optimized to avoid creating intermediate arrays per asset
export const selectFilterTagsDeleteState = createSelector(
  [selectAllImages, (state: RootState) => state.filters.filterTags],
  (images, filterTags) => {
    if (!filterTags.length || !images.length) {
      return {
        state: 'none' as const,
        hasAllToDelete: false,
        hasSomeToDelete: false,
        hasMixed: false,
      };
    }

    // Pre-convert filterTags to a Set for O(1) lookups
    const filterTagsSet = new Set(filterTags);

    let assetsWithAnyFilterTag = 0;
    let assetsWithAllFilterTagsToDelete = 0;
    let assetsWithSomeFilterTagsToDelete = 0;

    for (const asset of images) {
      // Count filter tags on this asset and how many are TO_DELETE
      // Avoids creating intermediate arrays
      let filterTagCount = 0;
      let toDeleteCount = 0;

      for (const tag of asset.tagList) {
        if (filterTagsSet.has(tag)) {
          // TO_ADD tags are removed outright by the action, not toggled,
          // so exclude them from the none/all/mixed state calculation
          if (hasState(asset.tagStatus[tag], TagState.TO_ADD)) continue;

          filterTagCount++;
          if (hasState(asset.tagStatus[tag], TagState.TO_DELETE)) {
            toDeleteCount++;
          }
        }
      }

      if (filterTagCount === 0) continue;

      assetsWithAnyFilterTag++;

      if (toDeleteCount === filterTagCount) {
        assetsWithAllFilterTagsToDelete++;
      } else if (toDeleteCount > 0) {
        assetsWithSomeFilterTagsToDelete++;
      }
    }

    const hasAllToDelete =
      assetsWithAllFilterTagsToDelete === assetsWithAnyFilterTag &&
      assetsWithAnyFilterTag > 0;
    const hasSomeToDelete =
      assetsWithSomeFilterTagsToDelete > 0 ||
      (assetsWithAllFilterTagsToDelete > 0 &&
        assetsWithAllFilterTagsToDelete < assetsWithAnyFilterTag);
    const hasMixed = hasSomeToDelete && !hasAllToDelete;

    let state: 'none' | 'all' | 'mixed';
    if (hasAllToDelete) {
      state = 'all';
    } else if (hasSomeToDelete) {
      state = 'mixed';
    } else {
      state = 'none';
    }

    return {
      state,
      hasAllToDelete,
      hasSomeToDelete,
      hasMixed,
    };
  },
);

// Optimized selector for filtered asset count only
// Avoids returning full array when only count is needed
export const selectFilteredAssetsCount = createSelector(
  [selectFilteredAssets],
  (filteredAssets) => filteredAssets.length,
);

// First tagless asset in filtered order — the exact order pagination slices,
// so the index maps straight to a page. Used by the jump-to-first-untagged
// hotkey.
export const selectFirstTaglessFilteredAsset = createSelector(
  [
    selectFilteredAssets,
    (state: RootState) => state.project.config.captionMode,
  ],
  (assets, captionMode) => {
    const index = assets.findIndex((asset) =>
      isAssetTagless(asset, captionMode),
    );
    return index === -1 ? null : { fileId: assets[index].fileId, index };
  },
);

// Selector to count how many files match each filename pattern
// Returns a map of pattern -> count
export const selectFilenamePatternCounts = createSelector(
  [selectAllImages, (state: RootState) => state.filters.filenamePatterns],
  (images, patterns): Record<string, number> => {
    if (!patterns || patterns.length === 0) return {};

    const counts: Record<string, number> = {};

    for (const pattern of patterns) {
      counts[pattern] = 0;
    }

    for (const image of images) {
      const lowerFileId = image.fileId.toLowerCase();
      for (const pattern of patterns) {
        if (lowerFileId.includes(pattern)) {
          counts[pattern]++;
        }
      }
    }

    return counts;
  },
);

// Cached Set of filter tags - avoids recreating the Set on every per-asset call
const selectFilterTagsSet = createSelector(
  [(state: RootState) => state.filters.filterTags],
  (filterTags): Set<string> => new Set(filterTags),
);

// Optimized selector for asset-specific highlighted tags
// Returns a Set of tag names that are both on this asset AND in the filter
// Only triggers re-renders when the intersection changes, not when unrelated filters change
export const selectAssetHighlightedTags = wrapSelector(
  'selectAssetHighlightedTags',
  createSelector(
    // Keyed on the single asset, not the whole `images` array — see the note on
    // selectOrderedTagsWithStatus
    [selectAssetById, selectFilterTagsSet],
    (asset, filterTagsSet) => {
      if (!asset || filterTagsSet.size === 0) return new Set<string>();

      // Only return tags that exist on this asset AND are in the filter
      const highlighted = new Set<string>();

      for (const tag of asset.tagList) {
        if (filterTagsSet.has(tag)) {
          highlighted.add(tag);
        }
      }

      return highlighted;
    },
    {
      // weakMapMemoize caches per-argument-combination instead of a single slot,
      // preventing cache thrashing when multiple components call with different assetIds
      memoize: weakMapMemoize,
      argsMemoize: weakMapMemoize,
      memoizeOptions: {
        // Custom equality check for Set comparison — when filter tags change but
        // the intersection with this asset's tags is unchanged, reuse the old reference
        resultEqualityCheck: (a: Set<string>, b: Set<string>) => {
          if (a.size !== b.size) return false;
          for (const item of a) {
            if (!b.has(item)) return false;
          }
          return true;
        },
      },
    },
  ),
);
