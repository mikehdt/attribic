import { createSelector } from '@reduxjs/toolkit';

import type { RootState } from '../';

// Basic selectors
export const selectSelectedAssets = (state: RootState) =>
  state.selection.selectedAssets;

export const selectLastClickedAssetId = (state: RootState) =>
  state.selection.lastClickedAssetId;

export const selectLastClickAction = (state: RootState) =>
  state.selection.lastClickAction;

const selectShiftHoverAssetId = (state: RootState) =>
  state.selection.shiftHoverAssetId;

export const selectCurrentAssetId = (state: RootState) =>
  state.selection.currentAssetId;

// Plain function returning a boolean primitive — cells subscribe to this so
// moving the current asset re-renders two cells, not the whole page
export const selectAssetIsCurrent = (state: RootState, assetId: string) =>
  state.selection.currentAssetId === assetId;

// Memoized Set for O(1) selection lookups — rebuilt only when selectedAssets changes
export const selectSelectedAssetsSet = createSelector(
  [selectSelectedAssets],
  (selectedAssets) => new Set(selectedAssets),
);

// Plain function — returns boolean primitive so useSelector handles equality.
// Uses the memoized Set for O(1) lookup instead of O(n) array.includes().
export const selectAssetIsSelected = (state: RootState, assetId: string) =>
  selectSelectedAssetsSet(state).has(assetId);

export const selectSelectedAssetsCount = createSelector(
  [selectSelectedAssets],
  (selectedAssets) => selectedAssets.length,
);

/**
 * The selection as an action sees it: everything ticked, plus the highlighted
 * asset as a soft member.
 *
 * Highlighting an asset already reads as "this one" — you moved to it to look
 * at it — so an action fired now should include it without demanding a tick
 * first, and Ctrl+Delete over a highlight outside the selection means "these,
 * and this one too". The soft member can never pile up: it is always exactly
 * the current asset, so moving the highlight moves it and nothing lingers.
 *
 * Deliberately not what the selection-*management* surfaces read. Clear
 * selection, Select All and the Selected scope and sort all stay on the ticked
 * set, so clearing still empties it and scoping to "Selected" doesn't quietly
 * drag the highlight in behind it. The "N selected" readout shows both, but
 * keeps them visibly apart ("3+1") rather than summing them.
 */
export const selectWorkingSelection = createSelector(
  [selectSelectedAssets, selectCurrentAssetId],
  (selectedAssets, currentAssetId) =>
    !currentAssetId || selectedAssets.includes(currentAssetId)
      ? selectedAssets
      : [...selectedAssets, currentAssetId],
);

// Memoized Set for O(1) lookups against the working selection
export const selectWorkingSelectionSet = createSelector(
  [selectWorkingSelection],
  (workingSelection) => new Set(workingSelection),
);

export const selectWorkingSelectionCount = createSelector(
  [selectWorkingSelection],
  (workingSelection) => workingSelection.length,
);

/**
 * 1 when the highlighted asset sits outside the ticked selection, else 0 — the
 * "+1" the readout shows for the soft member of the working selection.
 */
export const selectSoftSelectionCount = createSelector(
  [selectSelectedAssetsSet, selectCurrentAssetId],
  (selectedAssetsSet, currentAssetId) =>
    currentAssetId && !selectedAssetsSet.has(currentAssetId) ? 1 : 0,
);

/**
 * Selector to calculate which assets should show a preview state
 * when shift-hovering. Returns the preview asset IDs and whether
 * they would be selected or deselected.
 *
 * Takes paginatedAssetIds as a parameter since pagination is calculated
 * at the component level (not in Redux).
 */
export const selectShiftHoverPreview = createSelector(
  [
    selectLastClickedAssetId,
    selectLastClickAction,
    selectShiftHoverAssetId,
    selectSelectedAssets,
    (_, paginatedAssetIds: string[]) => paginatedAssetIds,
  ],
  (
    lastClickedAssetId,
    lastClickAction,
    shiftHoverAssetId,
    selectedAssets,
    paginatedAssetIds,
  ): {
    previewAssetIds: Set<string>;
    previewAction: 'select' | 'deselect';
  } | null => {
    // No preview if missing required state
    if (!lastClickedAssetId || !lastClickAction || !shiftHoverAssetId) {
      return null;
    }

    // Find indices of both assets in the paginated list
    const lastIndex = paginatedAssetIds.indexOf(lastClickedAssetId);
    const hoverIndex = paginatedAssetIds.indexOf(shiftHoverAssetId);

    // Both must be on the current page
    if (lastIndex === -1 || hoverIndex === -1) {
      return null;
    }

    // Don't show preview for the same asset
    if (lastIndex === hoverIndex) {
      return null;
    }

    // Get the range of assets between the two (inclusive)
    const startIndex = Math.min(lastIndex, hoverIndex);
    const endIndex = Math.max(lastIndex, hoverIndex);
    const rangeAssetIds = paginatedAssetIds.slice(startIndex, endIndex + 1);

    // Filter to only assets that would actually change state
    const selectedSet = new Set(selectedAssets);
    const previewAssetIds = new Set<string>();

    for (const assetId of rangeAssetIds) {
      const isCurrentlySelected = selectedSet.has(assetId);
      // Only include if the action would change the state
      if (lastClickAction === 'select' && !isCurrentlySelected) {
        previewAssetIds.add(assetId);
      } else if (lastClickAction === 'deselect' && isCurrentlySelected) {
        previewAssetIds.add(assetId);
      }
    }

    return {
      previewAssetIds,
      previewAction: lastClickAction,
    };
  },
);
