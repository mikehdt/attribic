import type { KeyboardEvent } from 'react';

/**
 * Focus an editing surface's primary control: the first tag chip when the
 * asset has tags (arrows take over from there), else the add-tag input, else
 * the first focusable control (caption mode). Returns false when the
 * container has nothing focusable, so the caller can summon an overlay or
 * let native Tab proceed.
 */
export const focusFirstEditorControl = (container: HTMLElement): boolean => {
  const target =
    container.querySelector<HTMLElement>('[data-tag-chip][tabindex="0"]') ??
    container.querySelector<HTMLElement>(
      '[data-tag-input="add"]:not(:disabled)',
    ) ??
    container.querySelector<HTMLElement>(
      'button:not(:disabled):not([data-inspector-close]), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
    );
  if (!target) return false;
  target.focus();
  return true;
};

/**
 * Focus the inline editor of a list row by asset id. Returns false when the
 * row isn't rendered or has nothing focusable.
 */
export const focusAssetRowEditor = (assetId: string): boolean => {
  const editor = document.querySelector<HTMLElement>(
    `[data-asset-id="${CSS.escape(assetId)}"] [data-asset-editor]`,
  );
  return !!editor && focusFirstEditorControl(editor);
};

/**
 * Escape hands keyboard control back to the gallery: blurring the focused
 * widget makes the window-level nav active again (it only needs focus to be
 * outside the editing surface). Widgets with an Escape meaning of their own
 * win first — the autocomplete preventDefaults its dismiss, the caption
 * editor blurs itself, and a text field keeps Escape while it still has
 * content to clear — so backing out is repeated Escapes, never a lost edit.
 */
export const handleEditorEscape = (e: KeyboardEvent<HTMLDivElement>) => {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  const target = e.target as HTMLElement;
  if (
    (target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement) &&
    target.value
  ) {
    return;
  }
  target.blur();
  e.preventDefault();
};
