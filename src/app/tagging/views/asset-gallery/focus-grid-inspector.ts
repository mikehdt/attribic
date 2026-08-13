import { focusFirstEditorControl } from './editor-focus';

export const isGridInspectorFocused = (): boolean => {
  const panel = document.querySelector<HTMLElement>('[data-grid-inspector]');
  return !!panel && panel.contains(document.activeElement);
};

/**
 * Focus the inspector's primary control (see focusFirstEditorControl).
 * Returns false when the inspector is hidden (narrow viewports) or has no
 * asset loaded, so the caller can summon the overlay or let native Tab
 * proceed.
 */
const focusGridInspector = (): boolean => {
  const panel = document.querySelector<HTMLElement>('[data-grid-inspector]');
  if (!panel || panel.offsetWidth === 0) return false;
  return focusFirstEditorControl(panel);
};

/**
 * Bring the tagging UI under the keyboard: focus the inspector column
 * outright, or — at widths where it's hidden — summon it as an overlay first
 * and focus once it has rendered. Shared by the Tab binding and the
 * click-an-inspected-cell-again gesture so both land in the same place.
 */
export const revealGridInspector = (setOverlayOpen: (open: boolean) => void) => {
  if (focusGridInspector()) return;
  setOverlayOpen(true);
  requestAnimationFrame(() => focusGridInspector());
};
