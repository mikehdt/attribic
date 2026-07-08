import {
  createListenerMiddleware,
  Dispatch,
  isAnyOf,
  UnknownAction,
} from '@reduxjs/toolkit';

import { composeDimensions } from '../../utils/helpers';
import { RootState } from '..';
import {
  addTag,
  deleteTag,
  editTag,
  resetAllModifiedTags,
  resetTags,
  selectHasModifiedAssets,
  selectHasTaglessAssets,
} from '../assets';
import {
  loadAllAssets,
  moveAssetsToFolderThunk,
  saveAllAssets,
  saveAsset,
} from '../assets/actions';
import { IoState } from '../assets/types';
import {
  addFilenamePattern,
  batchCleanupVisibility,
  ClassFilterMode,
  clearBucketFilters,
  clearExtensionFilters,
  clearSizeFilters,
  clearTagFilters,
  FilterMode,
  removeFilenamePattern,
  removeSubfolderFilters,
  selectHasActiveFilters,
  setFiltersRange,
  setTagFilterMode,
  toggleBucketFilter,
  toggleExtensionFilter,
  toggleSizeFilter,
  toggleSubfolderFilter,
  toggleTagFilter,
} from '../filters';
import { clearSelection } from '../selection';

/**
 * Generic helper to find invalid filters
 */
const findInvalidFilters = <T extends string>(
  activeFilters: T[],
  existingValues: Set<T>,
): T[] => {
  if (activeFilters.length === 0) return [];
  return activeFilters.filter((filter) => !existingValues.has(filter));
};

/**
 * Extract all existing filter values from assets
 */
const extractExistingValues = (state: RootState) => {
  const tags = new Set<string>();
  const sizes = new Set<string>();
  const buckets = new Set<string>();
  const extensions = new Set<string>();
  const subfolders = new Set<string>();

  state.assets.images.forEach((img) => {
    img.tagList.forEach((tag) => tags.add(tag));
    sizes.add(composeDimensions(img.dimensions));
    buckets.add(`${img.bucket.width}×${img.bucket.height}`);
    extensions.add(img.fileExtension);
    if (img.subfolder) subfolders.add(img.subfolder);
  });

  return { tags, sizes, buckets, extensions, subfolders };
};

/**
 * Generic helper to clean up invalid filters of a specific type
 */
const cleanupFilterType = (
  activeFilters: string[],
  existingValues: Set<string>,
  clearAction: () => UnknownAction,
  toggleAction: (value: string) => UnknownAction,
  dispatch: Dispatch<UnknownAction>,
): boolean => {
  const invalidFilters = findInvalidFilters(activeFilters, existingValues);

  if (invalidFilters.length === 0) return false;

  if (invalidFilters.length === activeFilters.length) {
    dispatch(clearAction());
  } else {
    invalidFilters.forEach((filter) => dispatch(toggleAction(filter)));
  }

  return true;
};

/**
 * Clean up invalid filters and return whether any changes were made
 */
const cleanupInvalidFilters = (
  state: RootState,
  dispatch: Dispatch<UnknownAction>,
): boolean => {
  const { assets, filters } = state;

  // Only proceed if data is stable
  if (
    assets.ioState !== IoState.COMPLETE &&
    assets.ioState !== IoState.COMPLETING
  ) {
    return false;
  }

  const existing = extractExistingValues(state);
  let hasChanges = false;

  // Clean up each filter type using the generic helper
  hasChanges =
    cleanupFilterType(
      filters.filterTags,
      existing.tags,
      clearTagFilters,
      toggleTagFilter,
      dispatch,
    ) || hasChanges;

  hasChanges =
    cleanupFilterType(
      filters.filterSizes,
      existing.sizes,
      clearSizeFilters,
      toggleSizeFilter,
      dispatch,
    ) || hasChanges;

  hasChanges =
    cleanupFilterType(
      filters.filterBuckets,
      existing.buckets,
      clearBucketFilters,
      toggleBucketFilter,
      dispatch,
    ) || hasChanges;

  hasChanges =
    cleanupFilterType(
      filters.filterExtensions,
      existing.extensions,
      clearExtensionFilters,
      toggleExtensionFilter,
      dispatch,
    ) || hasChanges;

  // Clean up subfolder filters referencing folders that no longer exist
  const invalidSubfolders = findInvalidFilters(
    filters.filterSubfolders,
    existing.subfolders,
  );
  if (invalidSubfolders.length > 0) {
    dispatch(removeSubfolderFilters(invalidSubfolders));
    hasChanges = true;
  }

  return hasChanges;
};

type VisibilityClassKey =
  'tags' | 'nameSearch' | 'sizes' | 'buckets' | 'extensions' | 'subfolders';

/**
 * Clean up visibility scope flags that no longer apply.
 * Computes all needed changes and dispatches a single batch action
 * instead of up to 9 individual dispatches.
 */
const cleanupVisibilityBatch = (
  state: RootState,
  dispatch: Dispatch<UnknownAction>,
): void => {
  const { visibility } = state.filters;

  const clearScopeTagless =
    visibility.scopeTagless && !selectHasTaglessAssets(state);
  const clearScopeSelected =
    visibility.scopeSelected && state.selection.selectedAssets.length === 0;
  const clearShowModified =
    visibility.showModified && !selectHasModifiedAssets(state);

  // Class modes — collect those that should reset to OFF
  const classSelections: Array<{
    key: VisibilityClassKey;
    selections: string[];
  }> = [
    { key: 'tags', selections: state.filters.filterTags },
    { key: 'nameSearch', selections: state.filters.filenamePatterns },
    { key: 'sizes', selections: state.filters.filterSizes },
    { key: 'buckets', selections: state.filters.filterBuckets },
    { key: 'extensions', selections: state.filters.filterExtensions },
    { key: 'subfolders', selections: state.filters.filterSubfolders },
  ];

  const resetClassModes: VisibilityClassKey[] = [];
  for (const { key, selections } of classSelections) {
    if (visibility[key] !== ClassFilterMode.OFF && selections.length === 0) {
      resetClassModes.push(key);
    }
  }

  // Only dispatch if there's something to clean up
  if (
    clearScopeTagless ||
    clearScopeSelected ||
    clearShowModified ||
    resetClassModes.length > 0
  ) {
    dispatch(
      batchCleanupVisibility({
        clearScopeTagless,
        clearScopeSelected,
        clearShowModified,
        resetClassModes,
      }),
    );
  }
};

/**
 * Check if filter mode should be reset to SHOW_ALL
 */
const shouldResetFilterMode = (state: RootState): boolean => {
  const { filters, selection } = state;

  // TAGLESS mode: reset if no tagless assets exist
  if (filters.filterMode === FilterMode.TAGLESS) {
    return !selectHasTaglessAssets(state);
  }

  // SELECTED_ASSETS mode: reset if no assets selected
  if (filters.filterMode === FilterMode.SELECTED_ASSETS) {
    return selection.selectedAssets.length === 0;
  }

  // General case: reset if no active filters but mode isn't SHOW_ALL
  if (
    !selectHasActiveFilters(state) &&
    filters.filterMode !== FilterMode.SHOW_ALL
  ) {
    return true;
  }

  return false;
};

export const filterManagerMiddleware = createListenerMiddleware();

// Listen to save/load/move completion and clean up invalid filters
filterManagerMiddleware.startListening({
  matcher: isAnyOf(
    saveAllAssets.fulfilled,
    saveAsset.fulfilled,
    loadAllAssets.fulfilled,
    moveAssetsToFolderThunk.fulfilled,
  ),
  effect: async (_action, listenerApi) => {
    const state = listenerApi.getState() as RootState;

    // Clean up invalid filters
    const hasChanges = cleanupInvalidFilters(state, listenerApi.dispatch);

    // Clean up visibility scope flags and class modes
    cleanupVisibilityBatch(
      listenerApi.getState() as RootState,
      listenerApi.dispatch,
    );

    // Check if filter mode needs reset (after cleanup)
    if (hasChanges) {
      const updatedState = listenerApi.getState() as RootState;
      if (shouldResetFilterMode(updatedState)) {
        listenerApi.dispatch(setTagFilterMode(FilterMode.SHOW_ALL));
      }
    }
  },
});

// Listen to tag operations and update filters/mode accordingly.
// resetTags / resetAllModifiedTags are included so that reverting changes
// clears the "show modified only" scope once no assets are modified.
filterManagerMiddleware.startListening({
  matcher: isAnyOf(addTag, deleteTag, editTag, resetTags, resetAllModifiedTags),
  effect: async (action, listenerApi) => {
    const state = listenerApi.getState() as RootState;

    // Handle TAGLESS mode auto-exit
    if (state.filters.filterMode === FilterMode.TAGLESS) {
      if (!selectHasTaglessAssets(state)) {
        listenerApi.dispatch(setTagFilterMode(FilterMode.SHOW_ALL));
        return;
      }
    }

    // Clean up visibility scope flags after tag operations
    cleanupVisibilityBatch(state, listenerApi.dispatch);

    // Handle tag deletion from filters
    if (deleteTag.match(action)) {
      const { tagName } = action.payload;
      if (state.filters.filterTags.includes(tagName)) {
        const tagStillExists = state.assets.images.some((img) =>
          img.tagList.includes(tagName),
        );
        if (!tagStillExists) {
          listenerApi.dispatch(toggleTagFilter(tagName));

          // Check if mode needs reset
          const updatedState = listenerApi.getState() as RootState;
          if (shouldResetFilterMode(updatedState)) {
            listenerApi.dispatch(setTagFilterMode(FilterMode.SHOW_ALL));
          }
        }
      }
    }

    // Handle tag edit in filters
    if (editTag.match(action)) {
      const { oldTagName, newTagName } = action.payload;
      if (state.filters.filterTags.includes(oldTagName)) {
        const oldTagStillExists = state.assets.images.some((img) =>
          img.tagList.includes(oldTagName),
        );

        if (!oldTagStillExists) {
          listenerApi.dispatch(toggleTagFilter(oldTagName));
          if (!state.filters.filterTags.includes(newTagName)) {
            listenerApi.dispatch(toggleTagFilter(newTagName));
          }
        }
      }
    }
  },
});

// Listen to filter toggles and reset mode/visibility if needed
filterManagerMiddleware.startListening({
  matcher: isAnyOf(
    toggleTagFilter,
    toggleSizeFilter,
    toggleExtensionFilter,
    toggleBucketFilter,
    toggleSubfolderFilter,
    setFiltersRange,
    addFilenamePattern,
    removeFilenamePattern,
    clearTagFilters,
    clearSizeFilters,
    clearExtensionFilters,
    clearBucketFilters,
  ),
  effect: async (_action, listenerApi) => {
    const state = listenerApi.getState() as RootState;

    // Reset class modes whose selections are now empty
    cleanupVisibilityBatch(state, listenerApi.dispatch);

    // Don't auto-reset for TAGLESS mode (has its own logic)
    if (
      state.filters.filterMode !== FilterMode.TAGLESS &&
      shouldResetFilterMode(state)
    ) {
      listenerApi.dispatch(setTagFilterMode(FilterMode.SHOW_ALL));
    }
  },
});

// Listen to selection clearing and reset scopeSelected if needed
filterManagerMiddleware.startListening({
  actionCreator: clearSelection,
  effect: async (_action, listenerApi) => {
    const state = listenerApi.getState() as RootState;
    if (state.filters.visibility.scopeSelected) {
      listenerApi.dispatch(
        batchCleanupVisibility({ clearScopeSelected: true }),
      );
    }
  },
});
