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
}

export const CategoryList = ({
  categoriesWithPageInfo,
  currentPage,
  onCategoryClick,
  onClose,
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

      <ul className="divide-y divide-slate-100 overflow-y-auto dark:divide-slate-700">
        {categoriesWithPageInfo.map(
          ({ category, page, isFirstOccurrence }, index) => {
            const isCurrentPage = page === currentPage;
            const anchorId = getCategoryAnchorId(category);

            // Show page number only when it changes from the previous item
            const showPageNumber =
              index === 0 || categoriesWithPageInfo[index - 1].page !== page;

            return (
              <li key={`${category}-${page}`}>
                {/* Use both category and page for unique keys */}
                <button
                  type="button"
                  onClick={() => onCategoryClick(page, anchorId)}
                  className={`flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left transition-colors hover:bg-blue-50 dark:hover:bg-slate-700 ${
                    isCurrentPage
                      ? 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-700 dark:bg-sky-900/50 dark:text-sky-300'
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
