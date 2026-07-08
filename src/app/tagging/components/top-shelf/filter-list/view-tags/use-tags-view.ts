import { useEffect, useMemo } from 'react';

import { selectTagCounts } from '@/app/store/assets';
import { selectFilterTags } from '@/app/store/filters';
import { useAppSelector } from '@/app/store/hooks';

import { useFilterContext } from '../filter-context';
import { useRangeToggle } from '../use-range-toggle';

export const useTagsView = () => {
  const allTags = useAppSelector(selectTagCounts);
  const activeTags = useAppSelector(selectFilterTags);

  const {
    sortType,
    sortDirection,
    searchTerm,
    setSearchTerm,
    updateListLength,
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
      // If sort type is active, compare by active state first
      if (sortType === 'active') {
        // First compare by active state
        if (a.isActive !== b.isActive) {
          // Default (desc) puts active items first, asc puts them last
          return sortDirection === 'desc'
            ? a.isActive
              ? -1
              : 1 // active items first when descending (default)
            : a.isActive
              ? 1
              : -1; // active items last when ascending
        }
        // If both have same active state, sort by count descending (9-0) as secondary criteria
        return b.count - a.count; // always descending count (9-0) as tie-breaker
      }
      // If sort type is count, compare by count then alphabetical (A-Z) as tie-breaker
      else if (sortType === 'count') {
        const countDiff =
          sortDirection === 'asc' ? a.count - b.count : b.count - a.count;
        if (countDiff !== 0) return countDiff;
        return a.tag.localeCompare(b.tag);
      }
      // Otherwise sort by tag name (alphabetical)
      else {
        return sortDirection === 'asc'
          ? a.tag.localeCompare(b.tag) // A-Z
          : b.tag.localeCompare(a.tag); // Z-A
      }
    });
  }, [allTags, activeTags, searchTerm, sortType, sortDirection]);

  // Update list length for keyboard navigation
  useEffect(() => {
    updateListLength(filteredTags.length);
  }, [filteredTags.length, updateListLength]);

  // Shift-click / Shift+Return range selection (and plain toggle)
  const { handleItemAction, previewState } = useRangeToggle({
    items: filteredTags,
    getValue: (item) => item.tag,
    getIsActive: (item) => item.isActive,
    classKey: 'filterTags',
  });

  // Keep the keyboard-highlighted tag scrolled into view
  useEffect(() => {
    if (selectedIndex >= 0 && selectedIndex < filteredTags.length) {
      const selectedTag = filteredTags[selectedIndex].tag;
      const tagEl = document.getElementById(`tag-${selectedTag}`);
      if (tagEl) {
        tagEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex, filteredTags]);

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
