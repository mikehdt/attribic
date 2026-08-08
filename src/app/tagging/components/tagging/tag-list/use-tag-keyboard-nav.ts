import { KeyboardEvent, useCallback } from 'react';

// Chips within this many pixels of each other's top edge count as one visual row
const ROW_TOLERANCE = 4;

type ChipRect = {
  chip: HTMLElement;
  rect: DOMRect;
};

/**
 * Find the chip visually above/below the anchor: the horizontally nearest
 * chip in the closest row in that direction. Geometry-based (same approach as
 * the grid view's cell navigation) because wrapped flex rows hold varying
 * chip counts, so index arithmetic can't know what sits above or below.
 */
const findVerticalNeighbour = (
  chips: HTMLElement[],
  anchor: HTMLElement,
  direction: 1 | -1,
): HTMLElement | null => {
  const anchorRect = anchor.getBoundingClientRect();
  const anchorCenterX = anchorRect.left + anchorRect.width / 2;

  const candidates: ChipRect[] = chips
    .map((chip) => ({ chip, rect: chip.getBoundingClientRect() }))
    .filter(({ rect }) =>
      direction === 1
        ? rect.top > anchorRect.top + ROW_TOLERANCE
        : rect.top < anchorRect.top - ROW_TOLERANCE,
    );
  if (!candidates.length) return null;

  const nextRowTop =
    direction === 1
      ? Math.min(...candidates.map(({ rect }) => rect.top))
      : Math.max(...candidates.map(({ rect }) => rect.top));
  const row = candidates.filter(
    ({ rect }) => Math.abs(rect.top - nextRowTop) <= ROW_TOLERANCE,
  );

  let best = row[0];
  for (const entry of row) {
    const centerX = entry.rect.left + entry.rect.width / 2;
    const bestCenterX = best.rect.left + best.rect.width / 2;
    if (
      Math.abs(centerX - anchorCenterX) < Math.abs(bestCenterX - anchorCenterX)
    ) {
      best = entry;
    }
  }
  return best.chip;
};

/**
 * Arrow-key navigation between tag chips, for the tag list container.
 * Left/right step through display order; up/down move to the visually
 * nearest chip in the adjacent wrapped row.
 *
 * Only acts while focus rests on a chip, a control inside one, or its
 * sortable wrapper — text inputs keep their caret keys, and an active drag
 * keeps dnd-kit's arrow handling (it moves the lifted chip instead).
 */
export const useTagKeyboardNav = (isDragActive: boolean) =>
  useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (isDragActive || e.defaultPrevented) return;
      const { key } = e;
      if (
        key !== 'ArrowLeft' &&
        key !== 'ArrowRight' &&
        key !== 'ArrowUp' &&
        key !== 'ArrowDown'
      ) {
        return;
      }

      const target = e.target as HTMLElement;
      if (target === e.currentTarget || target.closest('input, textarea')) {
        return;
      }

      // Focus may sit on the chip itself, a control inside it, or the
      // sortable wrapper around it — resolve all three to the chip
      const anchor =
        target.closest<HTMLElement>('[data-tag-chip]') ??
        target.querySelector<HTMLElement>('[data-tag-chip]');
      if (!anchor) return;

      // Non-interactive chips (faded, duplicate-matched) are skipped over;
      // the anchor stays in so navigation works from a chip that just faded
      const chips = Array.from(
        e.currentTarget.querySelectorAll<HTMLElement>('[data-tag-chip]'),
      ).filter((chip) => chip.tabIndex === 0 || chip === anchor);
      const index = chips.indexOf(anchor);
      if (index === -1) return;

      // Swallow the key even at a dead end — the page scrolling away from a
      // focused chip reads as lost focus, not as "no chip in that direction"
      e.preventDefault();

      const next =
        key === 'ArrowRight'
          ? (chips[index + 1] ?? null)
          : key === 'ArrowLeft'
            ? (chips[index - 1] ?? null)
            : findVerticalNeighbour(chips, anchor, key === 'ArrowDown' ? 1 : -1);

      if (next && next !== anchor) {
        next.focus();
        return;
      }

      // The add-tag input sits below the chips as the list's bottom "row"
      if (key === 'ArrowDown' && !next) {
        e.currentTarget
          .closest('[data-tag-list]')
          ?.querySelector<HTMLElement>('[data-tag-input="add"]:not(:disabled)')
          ?.focus();
      }
    },
    [isDragActive],
  );

/**
 * The other half of the vertical loop, attached to the tag list root (which
 * holds both the chips and the add-tag input): ArrowUp from the add input
 * climbs to the last chip — the natural return path after Tab lands on the
 * input. Only while the input is empty; with content, arrows belong to the
 * caret and the autocomplete list.
 */
export const handleAddInputArrowNav = (e: KeyboardEvent<HTMLDivElement>) => {
  if (e.key !== 'ArrowUp' || e.defaultPrevented) return;
  const target = e.target as HTMLElement;
  if (!target.matches('[data-tag-input="add"]')) return;
  if ((target as HTMLInputElement).value) return;

  const chips = Array.from(
    e.currentTarget.querySelectorAll<HTMLElement>('[data-tag-chip]'),
  ).filter((chip) => chip.tabIndex === 0);
  const last = chips[chips.length - 1];
  if (!last) return;

  e.preventDefault();
  last.focus();
};
