type LastClickAction = 'select' | 'deselect' | null;

interface SelectionState {
  selectedAssets: string[];
  // For shift-click range selection
  lastClickedAssetId: string | null;
  lastClickAction: LastClickAction;
  // For shift-hover preview (shows what would be selected/deselected)
  shiftHoverAssetId: string | null;
  // The single asset under inspection (grid view sidebar / keyboard focus).
  // Deliberately separate from selectedAssets: current = "what am I looking
  // at", selection = "what will batch operations apply to".
  currentAssetId: string | null;
}

export type { LastClickAction };

export const initialState: SelectionState = {
  selectedAssets: [],
  lastClickedAssetId: null,
  lastClickAction: null,
  shiftHoverAssetId: null,
  currentAssetId: null,
};
