import { useCallback, useMemo } from 'react';

import {
  clearBucketFilters,
  clearFileFilters,
  clearSizeFilters,
  clearTagFilters,
  selectFilterCount,
} from '@/app/store/filters';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';

import { useFilterContext } from './filter-context';
import { SortDirection } from './types';

export const FilterControls = () => {
  const {
    activeView,
    sizeSubView,
    sortDirection,
    setSortType,
    setSortDirection,
    setSearchTerm,
    setSelectedIndex,
    getSortOptions,
  } = useFilterContext();
  const dispatch = useAppDispatch();
  const filterCount = useAppSelector(selectFilterCount);

  // Single view/sub-view mapping so the disabled state, the dispatched clear
  // action, and the button title can never disagree about what's visible.
  const clearConfig = useMemo(() => {
    if (activeView === 'tag') {
      return {
        count: filterCount.tags,
        action: clearTagFilters,
        title: 'Clear tag filters',
      };
    }
    if (activeView === 'size') {
      return sizeSubView === 'dimensions'
        ? {
            count: filterCount.sizes,
            action: clearSizeFilters,
            title: 'Clear size filters',
          }
        : {
            count: filterCount.buckets,
            action: clearBucketFilters,
            title: 'Clear bucket filters',
          };
    }
    // File view shows name searches, subfolders and extensions
    return {
      count:
        filterCount.filenamePatterns +
        filterCount.subfolders +
        filterCount.extensions,
      action: clearFileFilters,
      title: 'Clear file filters',
    };
  }, [activeView, sizeSubView, filterCount]);

  const handleClearFilters = useCallback(() => {
    dispatch(clearConfig.action());
    // Clear search term and reset selected index
    setSearchTerm('');
    setSelectedIndex(-1);
  }, [clearConfig, dispatch, setSearchTerm, setSelectedIndex]);

  const handleSortType = useCallback(
    () => setSortType(getSortOptions().nextType),
    [getSortOptions, setSortType],
  );

  const handleSortDirection = useCallback(() => {
    const newDirection: SortDirection =
      sortDirection === 'asc' ? 'desc' : 'asc';
    setSortDirection(newDirection);
  }, [setSortDirection, sortDirection]);

  const isButtonDisabled = clearConfig.count === 0;

  return (
    <>
      <button
        onClick={handleSortType}
        className="cursor-pointer rounded rounded-tr-none rounded-br-none border border-r-0 border-slate-200 bg-white px-2 py-1 text-sm inset-shadow-xs inset-shadow-white transition-colors hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-700 dark:inset-shadow-white/10 dark:hover:bg-slate-600"
        title="Toggle sort type"
      >
        By {getSortOptions().typeLabel}
      </button>

      <button
        onClick={handleSortDirection}
        className="cursor-pointer rounded rounded-tl-none rounded-bl-none border border-slate-200 bg-white px-2 py-1 text-sm inset-shadow-xs inset-shadow-white transition-colors hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-700 dark:inset-shadow-white/10 dark:hover:bg-slate-600"
        title="Toggle sort direction"
      >
        Sort {getSortOptions().directionLabel}
      </button>

      <button
        onClick={handleClearFilters}
        className={`ml-auto rounded border border-slate-200 px-2 py-1 text-sm inset-shadow-xs inset-shadow-white transition-colors dark:border-slate-600 dark:inset-shadow-white/10 ${
          !isButtonDisabled
            ? 'cursor-pointer bg-white hover:bg-slate-100 dark:bg-slate-700 dark:hover:bg-slate-600'
            : 'cursor-not-allowed bg-slate-50 text-slate-400 dark:bg-slate-800 dark:text-slate-500'
        }`}
        disabled={isButtonDisabled}
        title={clearConfig.title}
      >
        Clear
      </button>
    </>
  );
};
