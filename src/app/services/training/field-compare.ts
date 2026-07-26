/**
 * Comparison of a training-form field value against its model default.
 *
 * Shared by the per-field reset affordance and the per-section
 * "hidden settings customised" count so the two always agree on what counts
 * as a change — they previously carried separate comparisons, and the looser
 * one missed numeric values that arrive as strings from an input event.
 */

/**
 * Loose equality for a field's current value against its default. Handles the
 * two shapes that trip up strict `===`:
 *  - arrays (only `resolution` today) — compared by JSON contents
 *  - numeric values that arrive as strings from an input's raw event value —
 *    coerced with `Number()` so "0.0001" matches 0.0001
 */
export function valuesDiffer(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return JSON.stringify(a) !== JSON.stringify(b);
  }
  const aIsNumeric =
    typeof a === 'number' || (typeof a === 'string' && a.trim() !== '');
  const bIsNumeric =
    typeof b === 'number' || (typeof b === 'string' && b.trim() !== '');
  if (
    aIsNumeric &&
    bIsNumeric &&
    (typeof a === 'number' || typeof b === 'number') &&
    !Number.isNaN(Number(a)) &&
    !Number.isNaN(Number(b))
  ) {
    return Number(a) !== Number(b);
  }
  return a !== b;
}
