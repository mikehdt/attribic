import { XIcon } from 'lucide-react';
import { ReactNode } from 'react';

import { highlightText } from '@/app/tagging/utils/text-highlight';
import { decomposeDimensions } from '@/app/utils/helpers';

import { SortType } from '../types';
import {
  RANGE_PREVIEW_DESELECT_CLASS,
  RANGE_PREVIEW_SELECT_SIZE,
} from '../use-range-toggle';
import { useSizesView } from './use-sizes-view';

/**
 * Normalization function for dimensions - replaces × with x for matching
 * @param text The text to normalize
 * @returns Normalized text
 */
export const normalizeDimensionText = (text: string): string =>
  text.replace('×', 'x');

// Get a visual representation of dimensions (used by both sizes and buckets views)
export const DimensionVisualizer = ({
  dimensions,
  isActive,
}: {
  dimensions: string;
  isActive: boolean;
}): ReactNode => {
  const { width, height } = decomposeDimensions(dimensions);
  const maxSize = 36; // Maximum box size for visualization
  let boxWidth, boxHeight;

  if (width >= height) {
    boxWidth = maxSize;
    boxHeight = Math.round((height / width) * maxSize);
  } else {
    boxHeight = maxSize;
    boxWidth = Math.round((width / height) * maxSize);
  }

  // Minimum size to keep box visible
  boxWidth = Math.max(boxWidth, 8);
  boxHeight = Math.max(boxHeight, 8);

  return (
    <div
      className={`border transition-colors ${
        isActive
          ? 'border-sky-500 bg-sky-200 dark:border-sky-400 dark:bg-sky-800'
          : 'border-slate-300 bg-slate-50 dark:border-slate-500 dark:bg-slate-700'
      }`}
      style={{ width: boxWidth, height: boxHeight }}
    />
  );
};

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
      {/* Search input section */}
      <div className="relative shrink-0 border-b border-slate-200 bg-slate-50 px-2 py-2 dark:border-slate-700 dark:bg-slate-800">
        <input
          ref={inputRef}
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
          placeholder="Search sizes..."
          className="w-full rounded-full border border-slate-300 bg-white py-1 ps-4 pe-8 inset-shadow-sm inset-shadow-slate-200 transition-all dark:border-slate-600 dark:bg-slate-700 dark:inset-shadow-slate-800"
        />
        <button
          className={`absolute top-3 right-4 h-5 w-5 rounded-full p-0.5 transition-colors ${
            searchTerm.trim() !== ''
              ? 'cursor-pointer text-slate-600 hover:bg-slate-500 hover:text-white dark:text-slate-400 dark:hover:bg-slate-600'
              : 'pointer-events-none text-white dark:text-slate-700'
          }`}
          onClick={
            searchTerm.trim() !== '' ? () => setSearchTerm('') : undefined
          }
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>

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
