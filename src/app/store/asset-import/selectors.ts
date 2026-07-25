import type { RootState } from '../index';

export const selectIsAssetImportOpen = (state: RootState) =>
  state.assetImport.isOpen;

export const selectAssetPickRequestId = (state: RootState) =>
  state.assetImport.pickRequestId;
