import { highlightText } from '@/app/shared/text-highlight';

import {
  DimensionVisualizer,
  normalizeDimensionText,
} from '../dimension-visualizer';
import { FilterSearchInput } from '../filter-search-input';
import { SortType } from '../types';
import {
  RANGE_PREVIEW_DESELECT_CLASS,
  RANGE_PREVIEW_SELECT_SIZE,
} from '../use-range-toggle';
import { useSizesView } from './use-sizes-view';

// Format the dimensions for display with proper × symbol
const formatDimensions = (dimensions: string): string => {
  if (!dimensions.includes('x')) return dimensions;
  return dimensions.replace('x', '×');
};

// Component to display conditional info based on sort type
const SizeInfo = ({
  item,
  sortType,
  searchTerm,
}: {
  item: {
    dimensions: string;
    width: number;
    height: number;
    count: number;
    pixelCount: number;
    ratio: string;
    type: string;
    isActive: boolean;
    formattedMP: string;
  };
  sortType: SortType;
  searchTerm: string;
}) => {
  // Format the main display based on sort type
  if (sortType === 'aspectRatio') {
    return (
      <>
        <div className="flex items-center justify-between tabular-nums">
          <span>
            <span className="text-slate-800 dark:text-slate-200">
              {searchTerm ? highlightText(item.ratio, searchTerm) : item.ratio}
            </span>
            <span className="mx-1 text-slate-300 dark:text-slate-600">•</span>
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {item.type}
            </span>
          </span>
          <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
            {item.count}
          </span>
        </div>
        <div className="flex text-xs tabular-nums">
          <span className="text-slate-500 dark:text-slate-400">
            {formatDimensions(item.dimensions)}
          </span>
          {item.pixelCount > 100000 && (
            <>
              <span className="mx-1 text-slate-300 dark:text-slate-600">•</span>
              <span className="text-slate-500 dark:text-slate-400">
                {item.formattedMP}
              </span>
            </>
          )}
        </div>
      </>
    );
  } else if (sortType === 'megapixels') {
    return (
      <>
        <div className="flex items-center justify-between tabular-nums">
          <span className="text-slate-800 dark:text-slate-200">
            {searchTerm
              ? highlightText(item.formattedMP, searchTerm)
              : item.formattedMP}
          </span>
          <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
            {item.count}
          </span>
        </div>
        <div className="flex text-xs tabular-nums">
          <span className="text-slate-500 dark:text-slate-400">
            {formatDimensions(item.dimensions)}
          </span>
          <span className="mx-1 text-slate-300 dark:text-slate-600">•</span>
          <span className="text-slate-500 dark:text-slate-400">
            {item.ratio}
          </span>
          <span className="mx-1 text-slate-300 dark:text-slate-600">•</span>
          <span className="text-slate-500 dark:text-slate-400">
            {item.type}
          </span>
        </div>
      </>
    );
  } else {
    return (
      <>
        <div className="flex items-center justify-between tabular-nums">
          <span className="text-slate-800 dark:text-slate-200">
            {searchTerm
              ? highlightText(
                  formatDimensions(item.dimensions),
                  searchTerm,
                  normalizeDimensionText,
                )
              : formatDimensions(item.dimensions)}
          </span>
          <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
            {item.count}
          </span>
        </div>
        <div className="flex text-xs tabular-nums">
          <span className="text-slate-500 dark:text-slate-400">
            {item.ratio}
          </span>
          <span className="mx-1 text-slate-300 dark:text-slate-600">•</span>
          <span className="text-slate-500 dark:text-slate-400">
            {item.type}
          </span>
          {item.pixelCount > 100000 ? (
            <>
              <span className="mx-1 text-slate-300 dark:text-slate-600">•</span>
              <span className="text-slate-500 dark:text-slate-400">
                {item.formattedMP}
              </span>
            </>
          ) : null}
        </div>
      </>
    );
  }
};

export const SizesView = () => {
  const {
    sortType,
    searchTerm,
    setSearchTerm,
    handleKeyDown,
    inputRef,
    filteredSizes,
    selectedIndex,
    handleItemAction,
    previewState,
    handleItemMouseMove,
    handleListMouseLeave,
  } = useSizesView();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FilterSearchInput
        value={searchTerm}
        onChange={setSearchTerm}
        onKeyDown={handleKeyDown}
        inputRef={inputRef}
        subject="sizes"
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Sizes list */}
        {filteredSizes.length === 0 ? (
          <div className="truncate p-4 text-center text-sm text-slate-500">
            {searchTerm
              ? `No sizes match "${searchTerm}"`
              : 'No sizes available'}
          </div>
        ) : (
          <ul
            className="divide-y divide-slate-100 dark:divide-slate-700"
            onMouseLeave={handleListMouseLeave}
          >
            {filteredSizes.map((item, index) => {
              const preview = previewState(item.dimensions);
              return (
                <li
                  id={`size-${item.dimensions}`}
                  key={item.dimensions}
                  onClick={(e) => {
                    if (e.shiftKey) e.preventDefault(); // avoid text selection
                    handleItemAction(index, e.shiftKey);
                  }}
                  onMouseMove={() => handleItemMouseMove(index)}
                  className={`flex min-h-14 cursor-pointer items-center justify-between px-3 py-2 transition-colors select-none ${
                    preview === 'select'
                      ? RANGE_PREVIEW_SELECT_SIZE
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
                      dimensions={item.dimensions}
                      isActive={item.isActive}
                    />
                  </div>

                  <div className="flex flex-1 flex-col">
                    <SizeInfo
                      item={item}
                      sortType={sortType}
                      searchTerm={searchTerm}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};
