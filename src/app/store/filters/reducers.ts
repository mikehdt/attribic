// Core reducers for the filters slice
import { PayloadAction } from '@reduxjs/toolkit';

import {
  ClassFilterMode,
  FilterArrayKey,
  FilterMode,
  Filters,
  PaginationSize,
} from './types';
import { toggleFilter } from './utils';

/** Key type for the class-based filter modes in visibility settings */
type VisibilityClassKey =
  | 'tags'
  | 'nameSearch'
  | 'sizes'
  | 'buckets'
  | 'extensions'
  | 'subfolders'
  | 'triggerPhrases';

export const coreReducers = {
  setTagFilterMode: (
    state: Filters,
    { payload }: PayloadAction<FilterMode>,
  ) => {
    state.filterMode = payload;
  },

  setPaginationSize: (
    state: Filters,
    { payload }: PayloadAction<PaginationSize>,
  ) => {
    state.paginationSize = payload;
  },

  toggleTagFilter: (state: Filters, { payload }: PayloadAction<string>) => {
    state.filterTags = toggleFilter(state.filterTags, payload);
    // Tagless scope is mutually exclusive with tag filters — clear it once
    // the user starts filtering by tags so the two don't conflict.
    if (state.filterTags.length > 0) {
      state.visibility.scopeTagless = false;
    }
  },

  toggleSizeFilter: (state: Filters, { payload }: PayloadAction<string>) => {
    state.filterSizes = toggleFilter(state.filterSizes, payload);
  },

  toggleBucketFilter: (state: Filters, { payload }: PayloadAction<string>) => {
    state.filterBuckets = toggleFilter(state.filterBuckets, payload);
  },

  toggleExtensionFilter: (
    state: Filters,
    { payload }: PayloadAction<string>,
  ) => {
    state.filterExtensions = toggleFilter(state.filterExtensions, payload);
  },

  toggleSubfolderFilter: (
    state: Filters,
    { payload }: PayloadAction<string>,
  ) => {
    state.filterSubfolders = toggleFilter(state.filterSubfolders, payload);
  },

  /**
   * Apply a batch of values to a filter class in a single transition — either
   * adding them all (union) or removing them all. Powers shift-click range
   * selection in the filter menus, which would otherwise dispatch N toggles
   * (and run the filter-manager cleanup N times).
   */
  setFiltersRange: (
    state: Filters,
    {
      payload,
    }: PayloadAction<{
      classKey: FilterArrayKey;
      values: string[];
      selected: boolean;
    }>,
  ) => {
    const { classKey, values, selected } = payload;
    if (values.length === 0) return;

    if (selected) {
      state[classKey] = [...new Set([...state[classKey], ...values])];
      // Mirror toggleTagFilter's guard: tag filters clear the Tagless scope.
      if (classKey === 'filterTags') {
        state.visibility.scopeTagless = false;
      }
    } else {
      const toRemove = new Set(values);
      state[classKey] = state[classKey].filter((v) => !toRemove.has(v));
    }
  },

  clearTagFilters: (state: Filters) => {
    state.filterTags = [];
  },

  clearSizeFilters: (state: Filters) => {
    state.filterSizes = [];
  },

  clearBucketFilters: (state: Filters) => {
    state.filterBuckets = [];
  },

  clearExtensionFilters: (state: Filters) => {
    state.filterExtensions = [];
  },

  clearFilters: (state: Filters) => {
    state.filterTags = [];
    state.filterSizes = [];
    state.filterBuckets = [];
    state.filterExtensions = [];
    state.filterSubfolders = [];
    state.filenamePatterns = [];
    // Also clear visibility settings
    state.visibility.tags = ClassFilterMode.OFF;
    state.visibility.nameSearch = ClassFilterMode.OFF;
    state.visibility.sizes = ClassFilterMode.OFF;
    state.visibility.buckets = ClassFilterMode.OFF;
    state.visibility.extensions = ClassFilterMode.OFF;
    state.visibility.subfolders = ClassFilterMode.OFF;
    state.visibility.triggerPhrases = ClassFilterMode.OFF;
    state.visibility.scopeTagless = false;
    state.visibility.scopeSelected = false;
    state.visibility.showModified = false;
  },

  addFilenamePattern: (state: Filters, { payload }: PayloadAction<string>) => {
    const pattern = payload.trim().toLowerCase();
    // Only add if not empty and not already present
    if (pattern && !state.filenamePatterns.includes(pattern)) {
      state.filenamePatterns.push(pattern);
    }
  },

  removeFilenamePattern: (
    state: Filters,
    { payload }: PayloadAction<string>,
  ) => {
    state.filenamePatterns = state.filenamePatterns.filter(
      (p) => p !== payload,
    );
  },

  // Reset filter mode if it's SELECTED_ASSETS and there are no selected assets
  resetFilterModeIfNeeded: (
    state: Filters,
    { payload }: PayloadAction<{ hasSelectedAssets: boolean }>,
  ) => {
    if (
      state.filterMode === FilterMode.SELECTED_ASSETS &&
      !payload.hasSelectedAssets
    ) {
      state.filterMode = FilterMode.SHOW_ALL;
    }
  },

  // Update tag filter names when tags are edited
  updateTagFilters: (
    state: Filters,
    {
      payload,
    }: PayloadAction<
      Array<{
        oldTagName: string;
        newTagName: string;
        operation: 'RENAME' | 'DELETE';
      }>
    >,
  ) => {
    // Process each tag update
    payload.forEach(({ oldTagName, newTagName, operation }) => {
      const index = state.filterTags.indexOf(oldTagName);
      if (index !== -1) {
        if (operation === 'RENAME') {
          // Replace the old tag with the new one
          state.filterTags[index] = newTagName;
        } else if (operation === 'DELETE') {
          // Remove the tag from filters
          state.filterTags.splice(index, 1);
        }
      }
    });

    // Deduplicate the filter tags to remove any duplicates that might have been created
    state.filterTags = [...new Set(state.filterTags)];
  },

  // Visibility control reducers

  /** Toggle a class filter mode. If already set to the given mode, switch to OFF. */
  setVisibilityClassMode: (
    state: Filters,
    {
      payload,
    }: PayloadAction<{ classKey: VisibilityClassKey; mode: ClassFilterMode }>,
  ) => {
    const { classKey, mode } = payload;
    // Toggle behaviour: clicking the active mode turns it off
    state.visibility[classKey] =
      state.visibility[classKey] === mode ? ClassFilterMode.OFF : mode;
  },

  toggleVisibilityScopeTagless: (state: Filters) => {
    // Mirror the UI guard: can't enable Tagless while tag filters are set.
    if (!state.visibility.scopeTagless && state.filterTags.length > 0) return;
    state.visibility.scopeTagless = !state.visibility.scopeTagless;
  },

  toggleVisibilityScopeSelected: (state: Filters) => {
    state.visibility.scopeSelected = !state.visibility.scopeSelected;
  },

  toggleVisibilityModified: (state: Filters) => {
    state.visibility.showModified = !state.visibility.showModified;
  },

  /**
   * Batch cleanup for visibility settings — applies multiple scope clears and
   * class mode resets in a single state transition instead of N separate dispatches.
   * Used by filter-manager middleware to avoid cascading re-renders.
   */
  batchCleanupVisibility: (
    state: Filters,
    {
      payload,
    }: PayloadAction<{
      clearScopeTagless?: boolean;
      clearScopeSelected?: boolean;
      clearShowModified?: boolean;
      resetClassModes?: (
        | 'tags'
        | 'nameSearch'
        | 'sizes'
        | 'buckets'
        | 'extensions'
        | 'subfolders'
        | 'triggerPhrases'
      )[];
    }>,
  ) => {
    if (payload.clearScopeTagless) state.visibility.scopeTagless = false;
    if (payload.clearScopeSelected) state.visibility.scopeSelected = false;
    if (payload.clearShowModified) state.visibility.showModified = false;
    if (payload.resetClassModes) {
      for (const key of payload.resetClassModes) {
        state.visibility[key] = ClassFilterMode.OFF;
      }
    }
  },

  // Remove stale subfolder filters after folders are deleted
  removeSubfolderFilters: (
    state: Filters,
    { payload }: PayloadAction<string[]>,
  ) => {
    const toRemove = new Set(payload);
    state.filterSubfolders = state.filterSubfolders.filter(
      (f) => !toRemove.has(f),
    );
  },
};
