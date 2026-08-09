// Main slice definition
import { createSlice } from '@reduxjs/toolkit';

import { coreReducers } from './reducers';
import {
  ArchiveViewMode,
  ClassFilterMode,
  FilterMode,
  Filters,
  PaginationSize,
  VisibilitySettings,
} from './types';

const initialVisibility: VisibilitySettings = {
  tags: ClassFilterMode.OFF,
  nameSearch: ClassFilterMode.OFF,
  sizes: ClassFilterMode.OFF,
  buckets: ClassFilterMode.OFF,
  extensions: ClassFilterMode.OFF,
  subfolders: ClassFilterMode.OFF,
  triggerPhrases: ClassFilterMode.OFF,
  scopeTagless: false,
  scopeSelected: false,
  showModified: false,
  archiveView: ArchiveViewMode.HIDDEN,
};

const initialState: Filters = {
  filterMode: FilterMode.SHOW_ALL,
  filterTags: [],
  filterSizes: [],
  filterBuckets: [],
  filterExtensions: [],
  filterSubfolders: [],
  filenamePatterns: [],
  paginationSize: PaginationSize.ONE_HUNDRED,
  visibility: initialVisibility,
};

const filtersSlice = createSlice({
  name: 'filters',
  initialState,
  reducers: coreReducers,
  // Simple property accessors defined inline, complex selectors still in selectors.ts
  selectors: {
    selectFilterMode: (state) => state.filterMode,
    selectFilterTags: (state) => state.filterTags,
    selectFilterSizes: (state) => state.filterSizes,
    selectFilterBuckets: (state) => state.filterBuckets,
    selectFilterExtensions: (state) => state.filterExtensions,
    selectFilterSubfolders: (state) => state.filterSubfolders,
    selectFilenamePatterns: (state) => state.filenamePatterns,
    selectPaginationSize: (state) => state.paginationSize,
    selectVisibility: (state) => state.visibility,
    selectArchiveView: (state) => state.visibility.archiveView,
  },
});

// Main exports from slice
export const { reducer: filtersReducer } = filtersSlice;
export const {
  setTagFilterMode,
  setPaginationSize,
  toggleTagFilter,
  toggleSizeFilter,
  toggleBucketFilter,
  toggleExtensionFilter,
  toggleSubfolderFilter,
  setFiltersRange,

  clearTagFilters,
  updateTagFilters,
  clearSizeFilters,
  clearBucketFilters,
  clearExtensionFilters,
  clearFileFilters,
  clearFilters,
  clearSelections,
  clearVisibilityFilters,
  resetFilterModeIfNeeded,
  removeSubfolderFilters,
  addFilenamePattern,
  removeFilenamePattern,
  setVisibilityClassMode,
  setVisibilityArchiveView,
  toggleVisibilityScopeTagless,
  toggleVisibilityScopeSelected,
  toggleVisibilityModified,
  batchCleanupVisibility,
} = filtersSlice.actions;

// Export the selectors from the slice
export const {
  selectFilterMode,
  selectFilterTags,
  selectFilterSizes,
  selectFilterBuckets,
  selectFilterExtensions,
  selectFilterSubfolders,
  selectFilenamePatterns,
  selectPaginationSize,
  selectVisibility,
  selectArchiveView,
} = filtersSlice.selectors;

// Main exports for filters module
export * from './selectors';
export * from './types';
export * from './utils';
