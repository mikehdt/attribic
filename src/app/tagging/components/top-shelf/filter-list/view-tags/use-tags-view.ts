import { useCallback, useMemo } from 'react';

import { selectTagCounts } from '@/app/store/assets';
import { selectFilterTags } from '@/app/store/filters';
import { useAppSelector } from '@/app/store/hooks';

import { compareByActive, compareByCount, compareByName } from '../comparators';
import { useFilterContext } from '../filter-context';
import { useFilterListEffects } from '../hooks/use-filter-list-effects';
import { useRangeToggle } from '../use-range-toggle';

export const useTagsView = () => {
  const allTags = useAppSelector(selectTagCounts);
  const activeTags = useAppSelector(selectFilterTags);

  const {
    sortType,
    sortDirection,
    searchTerm,
    setSearchTerm,
    selectedIndex,
    inputRef,
    handleKeyDown,
    handleItemMouseMove,
    handleListMouseLeave,
  } = useFilterContext();

  // Filter and sort tags based on search term and sort settings
  const filteredTags = useMemo(() => {
    // Convert map to array and filter by search term (if present)
    const filter = searchTerm.toLowerCase();
    const list = Object.entries(allTags)
      .filter(([tag]) => {
        if (!filter) return true;
        return tag.toLowerCase().includes(filter);
      })
      .map(([tag, count]) => ({
        tag,
        count,
        isActive: activeTags.includes(tag),
      }));

    // Sort the tags
    return list.sort((a, b) => {
      if (sortType === 'active') return compareByActive(a, b, sortDirection);
      if (sortType === 'count') {
        // Alphabetical tie-break: equal-count tags are common, and an
        // arbitrary order there makes the list look unsorted.
        const byCount = compareByCount(a, b, sortDirection);
        return byCount !== 0 ? byCount : a.tag.localeCompare(b.tag);
      }
      return compareByName(a.tag, b.tag, sortDirection);
    });
  }, [allTags, activeTags, searchTerm, sortType, sortDirection]);

  useFilterListEffects(
    filteredTags.length,
    // Must match the encoded id scheme in view-tags.tsx
    useCallback(
      (index: number) => `tag-${encodeURIComponent(filteredTags[index].tag)}`,
      [filteredTags],
    ),
  );

  // Shift-click / Shift+Return range selection (and plain toggle)
  const { handleItemAction, previewState } = useRangeToggle({
    items: filteredTags,
    getValue: (item) => item.tag,
    getIsActive: (item) => item.isActive,
    classKey: 'filterTags',
  });

  return {
    searchTerm,
    setSearchTerm,
    handleKeyDown,
    inputRef,
    filteredTags,
    selectedIndex,
    handleItemAction,
    previewState,
    handleItemMouseMove,
    handleListMouseLeave,
  };
};
