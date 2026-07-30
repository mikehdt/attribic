/** Sticky header height — 6rem, matching `top-24`. */
const HEADER_OFFSET = 96;

/**
 * Scroll an anchor element clear of the sticky header. Shared with
 * `useAnchorScrolling`, which does the same thing for hash navigation — the
 * offset maths had two copies that could drift out of step with the header.
 *
 * Scrolls the element's parent when it has one: anchors sit inside an
 * asset-group, and landing on the group reads better than landing on the row.
 */
export const scrollAnchorIntoView = (anchorId: string) => {
  const element = document.getElementById(anchorId);
  if (!element) return false;

  const targetElement = element.parentElement || element;
  const elementPosition =
    targetElement.getBoundingClientRect().top + window.scrollY;

  window.scrollTo({
    top: elementPosition - HEADER_OFFSET,
    behavior: 'smooth',
  });
  return true;
};

/**
 * Scroll to an anchor and record it in the URL hash, without letting Next.js
 * treat the change as a navigation.
 */
export const scrollToAnchor = (anchorId: string) => {
  // Only record an anchor that exists, as before — a hash pointing at nothing
  // would survive in the URL and be re-followed on the next load.
  if (!scrollAnchorIntoView(anchorId)) return;
  const newUrl = `${window.location.pathname}${window.location.search}#${anchorId}`;
  window.history.replaceState(null, '', newUrl);
};
