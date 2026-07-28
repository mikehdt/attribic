import { XIcon } from 'lucide-react';

import {
  CategoryInfo,
  getCategoryAnchorId,
} from '@/app/tagging/utils/category-utils';

interface CategoryListProps {
  categoriesWithPageInfo: CategoryInfo[];
  currentPage: number;
  onCategoryClick: (page: number, anchorId: string) => void;
  onClose: () => void;
  /** Index highlighted by keyboard/hover (from useListHighlight) */
  highlightedIndex: number;
  /** DOM id generator for aria-activedescendant/scroll targets */
  getOptionId: (index: number) => string;
  /** Hover-tracking props to spread on each item */
  getItemHoverProps: (index: number) => {
    onMouseMove: () => void;
    onMouseLeave: () => void;
  };
}

/** Prevent item clicks from stealing focus from the trigger button */
const handleItemMouseDown = (e: React.MouseEvent) => {
  e.preventDefault();
};

export const CategoryList = ({
  categoriesWithPageInfo,
  currentPage,
  onCategoryClick,
  onClose,
  highlightedIndex,
  getOptionId,
  getItemHoverProps,
}: CategoryListProps) => {
  return (
    <>
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-100 p-2 dark:border-slate-700 dark:bg-slate-700">
        <h3 className="text-sm font-medium text-slate-700 dark:text-slate-200">
          Jump to Category
        </h3>

        <button
          onClick={onClose}
          className="ml-2 cursor-pointer rounded-full p-1 transition-colors hover:bg-slate-200 dark:hover:bg-slate-600"
          title="Close"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>

      <ul
        className="divide-y divide-slate-100 overflow-y-auto dark:divide-slate-700"
        role="menu"
      >
        {categoriesWithPageInfo.map(
          ({ category, page, isFirstOccurrence }, index) => {
            const isCurrentPage = page === currentPage;
            const isHighlighted = index === highlightedIndex;
            const anchorId = getCategoryAnchorId(category);

            // Show page number only when it changes from the previous item
            const showPageNumber =
              index === 0 || categoriesWithPageInfo[index - 1].page !== page;

            return (
              <li key={`${category}-${page}`} role="none">
                {/* Use both category and page for unique keys */}
                <button
                  type="button"
                  id={getOptionId(index)}
                  onMouseDown={handleItemMouseDown}
                  onClick={() => onCategoryClick(page, anchorId)}
                  {...getItemHoverProps(index)}
                  role="menuitem"
                  className={`flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left transition-colors ${
                    isHighlighted
                      ? isCurrentPage
                        ? 'bg-sky-100 text-sky-700 dark:bg-sky-800 dark:text-sky-300'
                        : 'bg-blue-50 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                      : isCurrentPage
                        ? 'bg-sky-50 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300'
                        : 'text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <span className="truncate">
                    {category}

                    {!isFirstOccurrence && (
                      <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">
                        (continued)
                      </span>
                    )}
                  </span>
                  {showPageNumber && (
                    <span
                      className={`text-xs ${
                        isCurrentPage
                          ? 'text-sky-600 dark:text-sky-400'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      Page {page}
                    </span>
                  )}
                </button>
              </li>
            );
          },
        )}
      </ul>
    </>
  );
};
