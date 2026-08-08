export const isGridInspectorFocused = (): boolean => {
  const panel = document.querySelector<HTMLElement>('[data-grid-inspector]');
  return !!panel && panel.contains(document.activeElement);
};

/**
 * Focus the inspector's primary control: the first tag chip when the asset
 * has tags (arrows take over from there), else the add-tag input, else the
 * first focusable control (caption mode). Returns false when the inspector
 * is hidden (narrow viewports) or has no asset loaded, so the caller can
 * summon the overlay or let native Tab proceed.
 */
export const focusGridInspector = (): boolean => {
  const panel = document.querySelector<HTMLElement>('[data-grid-inspector]');
  if (!panel || panel.offsetWidth === 0) return false;
  const target =
    panel.querySelector<HTMLElement>('[data-tag-chip][tabindex="0"]') ??
    panel.querySelector<HTMLElement>('[data-tag-input="add"]:not(:disabled)') ??
    panel.querySelector<HTMLElement>(
      'button:not(:disabled):not([data-inspector-close]), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
    );
  if (!target) return false;
  target.focus();
  return true;
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
