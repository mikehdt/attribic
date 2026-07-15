import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { PaginationSize, selectPaginationSize } from '@/app/store/filters';
import { useAppSelector } from '@/app/store/hooks';

type PaginationProps = {
  currentPage: number;
  totalItems: number;
  basePath?: string;
};

export const Pagination = ({
  currentPage,
  totalItems,
  basePath,
}: PaginationProps) => {
  const params = useParams();
  const resolvedBasePath =
    basePath ??
    (params.project
      ? `/tagging/${encodeURIComponent(params.project as string)}`
      : '/tagging');
  const paginationSize = useAppSelector(selectPaginationSize);

  // Calculate total pages
  const totalPages =
    paginationSize === PaginationSize.ALL
      ? 1
      : Math.ceil(totalItems / paginationSize);
  const renderPaginationButtons = () => {
    const pages: React.ReactNode[] = [];

    // Previous page button
    const prevPage = Math.max(1, currentPage - 1);
    pages.push(
      <Link
        key="prev"
        href={`${resolvedBasePath}/${prevPage}`}
        prefetch={true}
        scroll={true}
        className={`mr-1 flex items-center rounded p-1 ${
          currentPage <= 1
            ? 'pointer-events-none text-slate-300 dark:text-slate-600'
            : 'text-slate-500 hover:bg-sky-100 dark:text-slate-400 dark:hover:bg-slate-700'
        }`}
        aria-label="Previous page"
        aria-disabled={currentPage <= 1}
      >
        <ChevronLeftIcon className="h-5 w-5" />
      </Link>,
    );

    // Calculate which page numbers to show
    let startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, startPage + 4);

    // Adjust start page if we're near the end
    if (endPage - startPage < 4) {
      startPage = Math.max(1, endPage - 4);
    }

    // First page
    if (startPage > 1) {
      pages.push(
        <Link
          key="1"
          href={`${resolvedBasePath}/1`}
          prefetch={true}
          scroll={true}
          aria-current={currentPage === 1 ? 'page' : undefined}
          className={`mx-1 rounded px-2 py-0.5 ${
            currentPage === 1
              ? 'bg-sky-500 text-white dark:bg-sky-700 dark:text-sky-300'
              : 'text-slate-500 hover:bg-sky-100 dark:text-slate-400 dark:hover:bg-slate-700'
          }`}
        >
          1
        </Link>,
      );

      // Ellipsis only if it covers 2 or more pages
      if (startPage > 3) {
        pages.push(
          <span
            key="ellipsis-start"
            className="cursor-default px-2 py-0.5 text-slate-300 dark:text-slate-600"
          >
            &hellip;
          </span>,
        );
      } else if (startPage === 3) {
        // Show page 2 instead of ellipsis
        pages.push(
          <Link
            key="2"
            href={`${resolvedBasePath}/2`}
            prefetch={true}
            scroll={true}
            aria-current={currentPage === 2 ? 'page' : undefined}
            className={`mx-1 rounded px-2 py-0.5 ${
              currentPage === 2
                ? 'bg-sky-500 text-white dark:bg-sky-700 dark:text-sky-300'
                : 'text-slate-500 hover:bg-sky-100 dark:text-slate-400 dark:hover:bg-slate-700'
            }`}
          >
            2
          </Link>,
        );
      }
    }

    // Page numbers
    for (let i = startPage; i <= endPage; i++) {
      pages.push(
        <Link
          key={i}
          href={`${resolvedBasePath}/${i}`}
          prefetch={true}
          scroll={true}
          aria-current={currentPage === i ? 'page' : undefined}
          className={`mx-1 rounded px-2 py-0.5 ${
            currentPage === i
              ? 'bg-sky-500 text-white dark:bg-sky-700 dark:text-sky-300'
              : 'text-slate-500 hover:bg-sky-100 dark:text-slate-400 dark:hover:bg-slate-700'
          }`}
        >
          {i}
        </Link>,
      );
    }

    // Last page if needed
    if (endPage < totalPages) {
      // Ellipsis only if it covers 2 or more pages
      if (endPage < totalPages - 2) {
        pages.push(
          <span
            key="ellipsis-end"
            className="cursor-default px-2 py-0.5 text-slate-300 dark:text-slate-600"
          >
            &hellip;
          </span>,
        );
      } else if (endPage === totalPages - 2) {
        // Show the second-to-last page instead of ellipsis
        pages.push(
          <Link
            key={totalPages - 1}
            href={`${resolvedBasePath}/${totalPages - 1}`}
            prefetch={true}
            scroll={true}
            aria-current={currentPage === totalPages - 1 ? 'page' : undefined}
            className={`mx-1 rounded px-2 py-0.5 ${
              currentPage === totalPages - 1
                ? 'bg-sky-500 text-white dark:bg-sky-700 dark:text-sky-300'
                : 'text-slate-500 hover:bg-sky-100 dark:text-slate-400 dark:hover:bg-slate-700'
            }`}
          >
            {totalPages - 1}
          </Link>,
        );
      }

      pages.push(
        <Link
          key={totalPages}
          href={`${resolvedBasePath}/${totalPages}`}
          prefetch={true}
          scroll={true}
          aria-current={currentPage === totalPages ? 'page' : undefined}
          className={`mx-1 rounded px-2 py-0.5 ${
            currentPage === totalPages
              ? 'bg-sky-500 text-white dark:bg-sky-700 dark:text-sky-300'
              : 'text-slate-500 hover:bg-sky-100 dark:text-slate-400 dark:hover:bg-slate-700'
          }`}
        >
          {totalPages}
        </Link>,
      );
    }

    // Next page button
    const nextPage = Math.min(totalPages, currentPage + 1);
    pages.push(
      <Link
        key="next"
        href={`${resolvedBasePath}/${nextPage}`}
        prefetch={true}
        scroll={true}
        className={`ml-1 flex items-center rounded p-1 ${
          currentPage >= totalPages
            ? 'pointer-events-none text-slate-300 dark:text-slate-600'
            : 'text-slate-500 hover:bg-sky-100 dark:text-slate-400 dark:hover:bg-slate-700'
        }`}
        aria-label="Next page"
        aria-disabled={currentPage >= totalPages}
      >
        <ChevronRightIcon className="h-5 w-5" />
      </Link>,
    );

    return pages;
  };

  return (
    <div className="flex-inline flex items-center justify-center tabular-nums">
      {renderPaginationButtons()}
    </div>
  );
};
