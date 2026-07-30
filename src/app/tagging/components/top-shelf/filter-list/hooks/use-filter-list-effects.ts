import { useEffect } from 'react';

import { useFilterContext } from '../filter-context';

/**
 * The two effects every filter view needs: publish the rendered row count for
 * keyboard navigation, and keep the highlighted row scrolled into view.
 *
 * `elementIdAt` maps a keyboard index to the row's DOM id — each view ids its
 * rows differently (and the File view stacks two lists behind one index), so
 * that part stays with the view. Pass it memoised on the list it reads: the
 * scroll effect re-runs when it changes, which is what makes a re-sort scroll
 * the highlighted row back into view.
 */
export function useFilterListEffects(
  length: number,
  elementIdAt: (index: number) => string | null,
) {
  const { updateListLength, selectedIndex } = useFilterContext();

  useEffect(() => {
    updateListLength(length);
  }, [length, updateListLength]);

  useEffect(() => {
    if (selectedIndex < 0 || selectedIndex >= length) return;
    const id = elementIdAt(selectedIndex);
    if (!id) return;
    document.getElementById(id)?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, length, elementIdAt]);
}
