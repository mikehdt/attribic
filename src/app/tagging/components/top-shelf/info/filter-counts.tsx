import { memo, useMemo } from 'react';

import { selectFilterCount, selectVisibility } from '@/app/store/filters';
import { useAppSelector } from '@/app/store/hooks';

const FilterIndicatorsInfoComponent = () => {
  // Single memoised selector for all filter counts — avoids 6 array subscriptions
  const filterCount = useAppSelector(selectFilterCount);
  const visibility = useAppSelector(selectVisibility);

  const activeFilters = useMemo(
    () =>
      [
        {
          count: filterCount.sizes,
          label: filterCount.sizes === 1 ? 'size' : 'sizes',
          color:
            'bg-sky-50 border-sky-300 text-sky-600 dark:bg-sky-900 dark:text-sky-500',
        },
        {
          count: filterCount.buckets,
          label: filterCount.buckets === 1 ? 'bucket' : 'buckets',
          color:
            'bg-slate-50 border-slate-300 text-slate-600 dark:bg-slate-900 dark:text-slate-500',
        },
        {
          count: filterCount.tags,
          label: filterCount.tags === 1 ? 'tag' : 'tags',
          color:
            'bg-teal-50 border-teal-300 text-teal-600 dark:bg-teal-900 dark:text-teal-500',
        },
        {
          count: filterCount.extensions,
          label: filterCount.extensions === 1 ? 'type' : 'types',
          color:
            'bg-stone-50 border-stone-300 text-stone-600 dark:bg-stone-900 dark:text-stone-500',
        },
        {
          count: filterCount.subfolders,
          label: filterCount.subfolders === 1 ? 'subfolder' : 'subfolders',
          color:
            'bg-indigo-50 border-indigo-300 text-indigo-600 dark:bg-indigo-900 dark:text-indigo-500',
        },
        {
          count: filterCount.filenamePatterns,
          label:
            filterCount.filenamePatterns === 1
              ? 'name search'
              : 'name searches',
          color:
            'bg-violet-50 border-violet-300 text-violet-600 dark:bg-violet-900 dark:text-violet-500',
        },
        {
          count: visibility.scopeTagless ? 1 : 0,
          label: 'Tagless',
          color:
            'bg-slate-50 border-slate-300 text-slate-600 dark:bg-slate-900 dark:text-slate-500',
          hideCount: true,
        },
        {
          count: visibility.scopeSelected ? 1 : 0,
          label: 'Selected',
          color:
            'bg-purple-50 border-purple-300 text-purple-600 dark:bg-purple-900 dark:text-purple-500',
          hideCount: true,
        },
        {
          count: visibility.showModified ? 1 : 0,
          label: 'Modified',
          color:
            'bg-amber-50 border-amber-300 text-amber-600 dark:bg-amber-900 dark:text-amber-500',
          hideCount: true,
        },
      ].filter((filter) => filter.count > 0),
    [
      filterCount,
      visibility.scopeTagless,
      visibility.scopeSelected,
      visibility.showModified,
    ],
  );

  if (activeFilters.length === 0) {
    return (
      <div className="text-xs text-(--unselected-text)">
        <span>No active filters</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {activeFilters.map((filter) => (
        <div
          key={filter.label}
          className={`flex items-center rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums ${filter.color}`}
        >
          {filter.hideCount ? filter.label : `${filter.count} ${filter.label}`}
        </div>
      ))}
    </div>
  );
};

export const FilterIndicatorsInfo = memo(FilterIndicatorsInfoComponent);
