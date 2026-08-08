import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import { initialState, type LastClickAction } from './types';

type SetAssetsSelectionPayload = {
  assetIds: string[];
  selected: boolean;
};

type TrackClickPayload = {
  assetId: string;
  action: LastClickAction;
};

const selectionSlice = createSlice({
  name: 'selection',
  initialState,
  reducers: {
    toggleAssetSelection: (state, action: PayloadAction<string>) => {
      const assetId = action.payload;
      const index = state.selectedAssets.indexOf(assetId);

      if (index !== -1) {
        // Asset is already selected, so remove it
        state.selectedAssets.splice(index, 1);
      } else {
        // Asset is not selected, so add it
        state.selectedAssets.push(assetId);
      }
    },
    selectMultipleAssets: (state, action: PayloadAction<string[]>) => {
      const uniqueAssets = [
        ...new Set([...state.selectedAssets, ...action.payload]),
      ];
      state.selectedAssets = uniqueAssets;
    },
    clearSelection: (state) => {
      state.selectedAssets = [];
    },
    // Set multiple assets to a specific selection state (for shift-click range)
    setAssetsSelectionState: (
      state,
      action: PayloadAction<SetAssetsSelectionPayload>,
    ) => {
      const { assetIds, selected } = action.payload;
      if (selected) {
        // Add all assets that aren't already selected
        const uniqueAssets = [
          ...new Set([...state.selectedAssets, ...assetIds]),
        ];
        state.selectedAssets = uniqueAssets;
      } else {
        // Remove all specified assets from selection (Set for O(1) lookups)
        const toRemove = new Set(assetIds);
        state.selectedAssets = state.selectedAssets.filter(
          (id) => !toRemove.has(id),
        );
      }
    },
    // Track the last clicked asset for shift-click range selection
    trackAssetClick: (state, action: PayloadAction<TrackClickPayload>) => {
      state.lastClickedAssetId = action.payload.assetId;
      state.lastClickAction = action.payload.action;
    },
    // Clear shift-click tracking (e.g., on page change)
    clearClickTracking: (state) => {
      state.lastClickedAssetId = null;
      state.lastClickAction = null;
      state.shiftHoverAssetId = null;
    },
    // Track hovered asset for shift-hover preview
    setShiftHoverAssetId: (state, action: PayloadAction<string | null>) => {
      state.shiftHoverAssetId = action.payload;
    },
    // Set the asset under inspection (null clears it)
    setCurrentAsset: (state, action: PayloadAction<string | null>) => {
      state.currentAssetId = action.payload;
    },
    // Remap fileIds after assets are moved between folders
    remapSelectedAssets: (
      state,
      action: PayloadAction<{ remaps: Record<string, string> }>,
    ) => {
      const { remaps } = action.payload;
      state.selectedAssets = state.selectedAssets.map((id) => remaps[id] ?? id);
      if (state.lastClickedAssetId && remaps[state.lastClickedAssetId]) {
        state.lastClickedAssetId = remaps[state.lastClickedAssetId];
      }
      if (state.currentAssetId && remaps[state.currentAssetId]) {
        state.currentAssetId = remaps[state.currentAssetId];
      }
    },
  },
});

export const {
  toggleAssetSelection,
  selectMultipleAssets,
  clearSelection,
  setAssetsSelectionState,
  trackAssetClick,
  clearClickTracking,
  setShiftHoverAssetId,
  setCurrentAsset,
} = selectionSlice.actions;

export const selectionReducer = selectionSlice.reducer;
