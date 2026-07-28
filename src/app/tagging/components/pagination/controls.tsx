import { useParams, useRouter } from 'next/navigation';

import { Dropdown, DropdownItem } from '@/app/shared/dropdown';
import {
  PaginationSize,
  selectPaginationSize,
  setPaginationSize,
} from '@/app/store/filters';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';

type PaginationControlsProps = {
  currentPage: number;
  totalItems: number;
  basePath?: string;
};

export const PaginationControls = ({
  currentPage,
  totalItems,
  basePath,
}: PaginationControlsProps) => {
  const params = useParams();
  const resolvedBasePath =
    basePath ??
    (params.project
      ? `/tagging/${encodeURIComponent(params.project as string)}`
      : '/tagging');
  const router = useRouter();
  const dispatch = useAppDispatch();
  const paginationSize = useAppSelector(selectPaginationSize);

  // Define dropdown items for pagination sizes
  const paginationSizeItems: DropdownItem<PaginationSize>[] = [
    {
      value: PaginationSize.TWENTY_FIVE,
      label: PaginationSize.TWENTY_FIVE.toString(),
    },
    { value: PaginationSize.FIFTY, label: PaginationSize.FIFTY.toString() },
    {
      value: PaginationSize.ONE_HUNDRED,
      label: PaginationSize.ONE_HUNDRED.toString(),
    },
    {
      value: PaginationSize.TWO_HUNDRED,
      label: PaginationSize.TWO_HUNDRED.toString(),
    },
    ...(totalItems <= 500
      ? [
          {
            value: PaginationSize.ALL,
            label: <span className="flex justify-between">All</span>,
          },
        ]
      : []),
  ];

  // When pagination size changes, we need to redirect to page 1 if the current page
  // would be outside the new range
  const handlePaginationSizeChange = (newSize: PaginationSize) => {
    // Store the new size in Redux
    dispatch(setPaginationSize(newSize));

    // Don't navigate away immediately, let the Redux store update first
    requestAnimationFrame(() => {
      // If we're switching to "All", always go to page 1
      if (newSize === PaginationSize.ALL) {
        router.push(`${resolvedBasePath}/1`);
        return;
      }

      // Calculate new total pages
      const newTotalPages = Math.ceil(totalItems / newSize);

      // If current page is beyond the new range, redirect to page 1
      if (currentPage > newTotalPages) {
        router.push(`${resolvedBasePath}/1`);
      }
    });
  };

  return (
    <span className="flex items-center">
      <label
        htmlFor="pagination-size"
        className="mr-2 text-sm text-slate-500 max-lg:hidden"
      >
        Per page
      </label>
      <Dropdown
        items={paginationSizeItems}
        selectedValue={paginationSize}
        onChange={handlePaginationSizeChange}
        openUpward={true}
      />
    </span>
  );
};
