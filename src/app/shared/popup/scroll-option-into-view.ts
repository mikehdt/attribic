/** Pixels of the adjacent item kept visible when scrolling a highlight into view */
const HIGHLIGHT_PEEK = 14;

/**
 * Nearest ancestor that can actually scroll vertically. The popup root gets
 * inline `overflow-y: auto` when height-constrained, but some lists scroll an
 * inner div instead — walking up covers both without callers passing refs.
 */
function findScrollableAncestor(el: HTMLElement): HTMLElement | null {
  let parent = el.parentElement;
  while (parent && parent !== document.body) {
    if (parent.scrollHeight > parent.clientHeight) {
      const { overflowY } = getComputedStyle(parent);
      if (overflowY === 'auto' || overflowY === 'scroll') return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}

/**
 * Scroll a keyboard-highlighted option into view within its scrollable list,
 * keeping a small peek of the adjacent item visible so it's clear the list
 * continues. The genuinely first/last option pins the list to its end instead,
 * so anything beyond the options (group headers, pinned footers) is fully
 * revealed rather than cut to a peek that can never be resolved by arrowing.
 *
 * Keyboard navigation only — scrolling on hover would shift the list under
 * the cursor, changing the hovered item and cascading.
 */
export function scrollOptionIntoView(
  el: HTMLElement,
  { isFirst, isLast }: { isFirst: boolean; isLast: boolean },
): void {
  const container = findScrollableAncestor(el);
  if (!container) return;

  if (isFirst) {
    container.scrollTop = 0;
    return;
  }
  if (isLast) {
    container.scrollTop = container.scrollHeight;
    return;
  }

  const containerRect = container.getBoundingClientRect();
  const viewTop = containerRect.top + container.clientTop;
  const viewBottom = viewTop + container.clientHeight;
  const elRect = el.getBoundingClientRect();

  const topOverhang = viewTop + HIGHLIGHT_PEEK - elRect.top;
  const bottomOverhang = elRect.bottom - (viewBottom - HIGHLIGHT_PEEK);

  if (topOverhang > 0) {
    container.scrollTop -= topOverhang;
  } else if (bottomOverhang > 0) {
    container.scrollTop += bottomOverhang;
  }
}
