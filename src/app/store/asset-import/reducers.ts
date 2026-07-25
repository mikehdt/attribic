import { createSlice } from '@reduxjs/toolkit';

import type { AssetImportState } from './types';

const initialState: AssetImportState = {
  isOpen: false,
  pickRequestId: 0,
};

/**
 * The importer is triggered from two unrelated places — the project menu in the
 * top shelf and the drop zone on the empty-project screen — while the files and
 * the file input live with the drop handling, so requests pass through the store.
 *
 * The two entry points want different things. The empty screen is already a drop
 * zone, so clicking it means "let me choose files" and goes straight to the
 * picker. The menu has no drop target near it, so it opens the importer with one.
 */
const assetImportSlice = createSlice({
  name: 'assetImport',
  initialState,
  reducers: {
    openAssetImport: (state) => {
      state.isOpen = true;
    },
    closeAssetImport: (state) => {
      state.isOpen = false;
    },
    requestAssetPick: (state) => {
      state.pickRequestId += 1;
    },
  },
});

export const { openAssetImport, closeAssetImport, requestAssetPick } =
  assetImportSlice.actions;
export const assetImportReducer = assetImportSlice.reducer;
