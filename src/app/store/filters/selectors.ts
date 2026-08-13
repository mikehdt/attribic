// Complex selectors for filters slice
import { createSelector } from '@reduxjs/toolkit';

import type { RootState } from '../';
import { ArchiveViewMode, ClassFilterMode, FilterCount } from './types';

// Base selectors that extract filter state from RootState
// Note: These are local versions to avoid circular dependency with index.ts
// External consumers should use the slice selectors from the main exports
const selectFilterTags = (state: RootState) => state.filters.filterTags;
const selectFilterSizes = (state: RootState) => state.filters.filterSizes;
const selectFilterBuckets = (state: RootState) => state.filters.filterBuckets;
const selectFilterExtensions = (state: RootState) =>
  state.filters.filterExtensions;
const selectFilterSubfolders = (state: RootState) =>
  state.filters.filterSubfolders;
const selectFilenamePatterns = (state: RootState) =>
  state.filters.filenamePatterns;

export const selectHasActiveFilters = createSelector(
  selectFilterTags,
  selectFilterSizes,
  selectFilterBuckets,
  selectFilterExtensions,
  selectFilterSubfolders,
  selectFilenamePatterns,
  (
    filterTags,
    filterSizes,
    filterBuckets,
    filterExtensions,
    filterSubfolders,
    filenamePatterns,
  ) =>
    filterTags.length > 0 ||
    filterSizes.length > 0 ||
    filterBuckets.length > 0 ||
    filterExtensions.length > 0 ||
    filterSubfolders.length > 0 ||
    filenamePatterns.length > 0,
);

const selectVisibility = (state: RootState) => state.filters.visibility;

const selectProjectTriggerPhrases = (state: RootState) =>
  state.project.config.triggerPhrases;

/**
 * Active visibility ignoring the archive view — the archive count has its own
 * readout, so showing/hiding archives alone shouldn't light up "filtered".
 *
 * This is also the test bulk actions scope on. Showing the archive is how you
 * reach an archived asset in the first place, so if it counted as a filter,
 * opening Move with nothing selected would resolve its scope to the entire
 * gallery and sweep every folder into the destination.
 */
export const selectHasActiveNonArchiveVisibility = createSelector(
  selectVisibility,
  selectFilterTags,
  selectFilenamePatterns,
  selectFilterSizes,
  selectFilterBuckets,
  selectFilterExtensions,
  selectFilterSubfolders,
  selectProjectTriggerPhrases,
  (
    visibility,
    filterTags,
    filenamePatterns,
    filterSizes,
    filterBuckets,
    filterExtensions,
    filterSubfolders,
    triggerPhrases,
  ) =>
    visibility.scopeTagless ||
    visibility.scopeSelected ||
    visibility.showModified ||
    (visibility.tags !== ClassFilterMode.OFF && filterTags.length > 0) ||
    (visibility.nameSearch !== ClassFilterMode.OFF &&
      filenamePatterns.length > 0) ||
    (visibility.sizes !== ClassFilterMode.OFF && filterSizes.length > 0) ||
    (visibility.buckets !== ClassFilterMode.OFF && filterBuckets.length > 0) ||
    (visibility.extensions !== ClassFilterMode.OFF &&
      filterExtensions.length > 0) ||
    (visibility.subfolders !== ClassFilterMode.OFF &&
      filterSubfolders.length > 0) ||
    (visibility.triggerPhrases !== ClassFilterMode.OFF &&
      triggerPhrases.length > 0),
);

/**
 * True when any visibility setting is set at all — class modes or scopes —
 * regardless of whether it currently filters anything. Drives the enabled
 * state of the clear-filters button, which clears exactly this state.
 */
export const selectHasVisibilitySettings = createSelector(
  selectVisibility,
  (visibility) =>
    visibility.scopeTagless ||
    visibility.scopeSelected ||
    visibility.showModified ||
    visibility.archiveView !== ArchiveViewMode.HIDDEN ||
    visibility.tags !== ClassFilterMode.OFF ||
    visibility.nameSearch !== ClassFilterMode.OFF ||
    visibility.sizes !== ClassFilterMode.OFF ||
    visibility.buckets !== ClassFilterMode.OFF ||
    visibility.extensions !== ClassFilterMode.OFF ||
    visibility.subfolders !== ClassFilterMode.OFF ||
    visibility.triggerPhrases !== ClassFilterMode.OFF,
);

export const selectHasNonTagFilters = createSelector(
  selectFilterSizes,
  selectFilterBuckets,
  selectFilterExtensions,
  selectFilterSubfolders,
  selectFilenamePatterns,
  (
    filterSizes,
    filterBuckets,
    filterExtensions,
    filterSubfolders,
    filenamePatterns,
  ) =>
    filterSizes.length > 0 ||
    filterBuckets.length > 0 ||
    filterExtensions.length > 0 ||
    filterSubfolders.length > 0 ||
    filenamePatterns.length > 0,
);

export const selectFilterCount = createSelector(
  selectFilterTags,
  selectFilterSizes,
  selectFilterBuckets,
  selectFilterExtensions,
  selectFilterSubfolders,
  selectFilenamePatterns,
  (
    filterTags,
    filterSizes,
    filterBuckets,
    filterExtensions,
    filterSubfolders,
    filenamePatterns,
  ): FilterCount => ({
    tags: filterTags.length,
    sizes: filterSizes.length,
    buckets: filterBuckets.length,
    extensions: filterExtensions.length,
    subfolders: filterSubfolders.length,
    filenamePatterns: filenamePatterns.length,
    total:
      filterTags.length +
      filterSizes.length +
      filterBuckets.length +
      filterExtensions.length +
      filterSubfolders.length +
      filenamePatterns.length,
  }),
);
