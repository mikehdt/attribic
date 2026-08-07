import { highlightText } from '@/app/shared/text-highlight';

import {
  DimensionVisualizer,
  normalizeDimensionText,
} from '../dimension-visualizer';
import { FilterSearchInput } from '../filter-search-input';
import {
  RANGE_PREVIEW_DESELECT_CLASS,
  RANGE_PREVIEW_SELECT_BUCKETS,
} from '../use-range-toggle';
import { useBucketsView } from './use-buckets-view';

export const BucketsView = () => {
  const {
    searchTerm,
    setSearchTerm,
    handleKeyDown,
    inputRef,
    bucketList,
    selectedIndex,
    handleItemAction,
    previewState,
    handleItemMouseMove,
    handleListMouseLeave,
  } = useBucketsView();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FilterSearchInput
        value={searchTerm}
        onChange={setSearchTerm}
        onKeyDown={handleKeyDown}
        inputRef={inputRef}
        subject="buckets"
      />

      {/* Buckets list */}
      {bucketList.length === 0 ? (
        <div className="truncate p-4 text-center text-sm text-slate-500 dark:text-slate-400">
          {searchTerm
            ? `No buckets match "${searchTerm}"`
            : 'No buckets available'}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ul
            className="divide-y divide-slate-100 dark:divide-slate-700"
            onMouseLeave={handleListMouseLeave}
          >
            {bucketList.map((item, index) => {
              const preview = previewState(item.name);
              return (
                <li
                  id={`bucket-${item.name}`}
                  key={item.name}
                  onClick={(e) => {
                    if (e.shiftKey) e.preventDefault(); // avoid text selection
                    handleItemAction(index, e.shiftKey);
                  }}
                  onMouseMove={() => handleItemMouseMove(index)}
                  className={`flex min-h-14 cursor-pointer items-center justify-between px-3 py-2 transition-colors select-none ${
                    preview === 'select'
                      ? RANGE_PREVIEW_SELECT_BUCKETS
                      : preview === 'deselect'
                        ? RANGE_PREVIEW_DESELECT_CLASS
                        : index === selectedIndex
                          ? item.isActive
                            ? 'bg-sky-300 dark:bg-sky-700'
                            : 'bg-blue-100 dark:bg-blue-900/50'
                          : item.isActive
                            ? 'bg-sky-100 dark:bg-sky-900/50'
                            : ''
                  }`}
                >
                  <div className="mr-2 flex w-10 justify-center">
                    <DimensionVisualizer
                      dimensions={normalizeDimensionText(item.name)}
                      isActive={item.isActive}
                    />
                  </div>

                  <div className="flex flex-1 items-center justify-between tabular-nums">
                    <span className="text-slate-800 dark:text-slate-200">
                      {searchTerm
                        ? highlightText(
                            item.name,
                            searchTerm,
                            normalizeDimensionText,
                          )
                        : item.name}
                    </span>
                    <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
                      {item.count}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};
