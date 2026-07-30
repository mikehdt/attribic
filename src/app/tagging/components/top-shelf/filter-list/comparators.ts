/**
 * Sort comparators shared by the filter views.
 *
 * Every view sorts a list of `{ count, isActive }` rows by the same three
 * criteria (active state, count, name) and differs only in view-specific extras
 * — dimensions, aspect ratio, megapixels. Those extras stay in their own view;
 * the three common orderings live here, where the active-first tie-break rule
 * is written down once instead of four times.
 */

export type SortDirection = 'asc' | 'desc';

type CountedItem = { count: number; isActive: boolean };

/**
 * Active rows first (the default `desc`), last when ascending, with count
 * descending as the tie-break so the busiest active filter leads either way.
 */
export function compareByActive(
  a: CountedItem,
  b: CountedItem,
  direction: SortDirection,
): number {
  if (a.isActive !== b.isActive) {
    if (direction === 'desc') return a.isActive ? -1 : 1;
    return a.isActive ? 1 : -1;
  }
  return b.count - a.count;
}

export function compareByCount(
  a: CountedItem,
  b: CountedItem,
  direction: SortDirection,
): number {
  return direction === 'asc' ? a.count - b.count : b.count - a.count;
}

/** Locale-aware A–Z (`asc`) or Z–A (`desc`). */
export function compareByName(
  a: string,
  b: string,
  direction: SortDirection,
): number {
  return direction === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
}
