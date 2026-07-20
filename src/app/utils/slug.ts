/**
 * URL slugs for named entities that live behind an opaque id.
 *
 * Tagging projects can use their folder name directly in the URL because the
 * filesystem already guarantees uniqueness. Training projects are keyed by
 * UUID with a free-text name, so the name has to be reduced to something safe
 * to put in a path segment — and that reduction has to be stable, because the
 * slug is what a bookmark or a refresh resolves against.
 */

// Combining diacritics, left behind by NFKD once accents are split from their
// base letters.
const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Reduce a display name to a lowercase, hyphen-separated path segment.
 *
 * Accents are folded to their base letters so “Café” and “Cafe” don't produce
 * two different URLs for what a user reads as the same word. Returns an empty
 * string for a name with no alphanumeric content at all — callers must treat
 * that as "not sluggable" rather than as a valid slug.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}
