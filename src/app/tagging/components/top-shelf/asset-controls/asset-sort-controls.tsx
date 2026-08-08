import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo } from 'react';

import { Button } from '@/app/shared/button';
import { Dropdown, DropdownItem } from '@/app/shared/dropdown';
import { InputTray } from '@/app/shared/input-tray/input-tray';
import {
  selectHasSubfolderAssets,
  selectSortDirection,
  selectSortType,
  setSortDirection,
  setSortType,
  SortDirection,
  SortType,
  toggleSortDirection,
} from '@/app/store/assets';
import {
  FilterMode,
  selectFilterMode,
  selectHasActiveFilters,
} from '@/app/store/filters';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import { selectSelectedAssetsCount } from '@/app/store/selection';

/**
 * Get the appropriate sort direction label based on sort type
 */
const getSortDirectionLabel = (
  sortType: SortType,
  sortDirection: SortDirection,
): string => {
  const isAsc = sortDirection === SortDirection.ASC;

  switch (sortType) {
    case SortType.NAME:
      return isAsc ? 'A-Z' : 'Z-A';
    case SortType.INDEX:
      return isAsc ? '1-n' : 'n-1';
    case SortType.IMAGE_SIZE:
    case SortType.BUCKET_SIZE:
      return isAsc ? '0-9' : '9-0';
    case SortType.SCALED:
      return isAsc ? '1:1' : 'Diff';
    case SortType.SELECTED:
    case SortType.FILTERED:
      return isAsc ? '✓' : '○';
    case SortType.FOLDER:
      return isAsc ? '0-9' : '9-0';
    default:
      return isAsc ? 'A-Z' : 'Z-A';
  }
};

export const AssetSortControls = () => {
  const dispatch = useAppDispatch();

  const sortType = useAppSelector(selectSortType);
  const sortDirection = useAppSelector(selectSortDirection);
  const selectedAssetsCount = useAppSelector(selectSelectedAssetsCount);
  const filterMode = useAppSelector(selectFilterMode);
  const hasSubfolderAssets = useAppSelector(selectHasSubfolderAssets);

  // Boolean selector — avoids subscribing to 5 full arrays when only "any active?" is needed
  const filterSelectionActive = useAppSelector(selectHasActiveFilters);

  // FILTERED sort is disabled when no filters are set, or when filter mode
  // already hides non-matching assets (Match Any/All/Inverse)
  const filteredSortDisabled =
    !filterSelectionActive ||
    filterMode === FilterMode.MATCH_ANY ||
    filterMode === FilterMode.MATCH_ALL ||
    filterMode === FilterMode.MATCH_NONE;

  // Auto-switch to "Name" sort when current sort type becomes invalid
  useEffect(() => {
    const isInvalid =
      (sortType === SortType.SELECTED && selectedAssetsCount === 0) ||
      (sortType === SortType.FILTERED && filteredSortDisabled) ||
      (sortType === SortType.FOLDER && !hasSubfolderAssets);

    if (isInvalid) {
      dispatch(setSortType(SortType.NAME));
      dispatch(setSortDirection(SortDirection.ASC));
    }
  }, [
    sortType,
    selectedAssetsCount,
    filteredSortDisabled,
    hasSubfolderAssets,
    dispatch,
  ]);

  const handleSortTypeChange = useCallback(
    (newSortType: SortType) => {
      dispatch(setSortType(newSortType));
      // Reset sort direction to ascending (default) when changing sort type
      dispatch(setSortDirection(SortDirection.ASC));
    },
    [dispatch],
  );

  const handleToggleSortDirection = useCallback(() => {
    dispatch(toggleSortDirection());
  }, [dispatch]);

  const sortTypeItems: DropdownItem<SortType>[] = useMemo(
    () => [
      {
        value: SortType.NAME,
        label: 'Name',
      },
      {
        value: SortType.INDEX,
        label: 'Index',
      },
      {
        value: SortType.IMAGE_SIZE,
        label: 'Image Size',
      },
      {
        value: SortType.BUCKET_SIZE,
        label: 'Bucket Size',
      },
      {
        value: SortType.SCALED,
        label: 'Scaled',
      },
      {
        value: SortType.SELECTED,
        label: 'Selected',
        disabled: selectedAssetsCount === 0,
      },
      {
        value: SortType.FILTERED,
        label: 'Filtered',
        disabled: filteredSortDisabled,
      },
      {
        value: SortType.FOLDER,
        label: 'Subfolder',
        disabled: !hasSubfolderAssets,
      },
    ],
    [selectedAssetsCount, filteredSortDisabled, hasSubfolderAssets],
  );

  // Show as disabled styling if current sort type is no longer valid
  const showDisabledStyle =
    (sortType === SortType.SELECTED && selectedAssetsCount === 0) ||
    (sortType === SortType.FILTERED && filteredSortDisabled) ||
    (sortType === SortType.FOLDER && !hasSubfolderAssets);

  return (
    <InputTray tone="surface">
      <Dropdown
        size="toolbar"
        items={sortTypeItems}
        selectedValue={sortType}
        onChange={handleSortTypeChange}
        buttonClassName={showDisabledStyle ? 'text-slate-300' : ''}
      />

      <Button
        type="button"
        onClick={handleToggleSortDirection}
        variant="ghost"
        size="toolbar"
        title={`Sort ${sortDirection === SortDirection.ASC ? 'ascending' : 'descending'}`}
      >
        {sortDirection === SortDirection.ASC ? (
          <ArrowUpIcon />
        ) : (
          <ArrowDownIcon />
        )}

        <span className="ml-1 max-2xl:hidden">
          {getSortDirectionLabel(sortType, sortDirection)}
        </span>
      </Button>
    </InputTray>
  );
};
