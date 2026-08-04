// Define sort types and directions as constants
export type SortType =
  | 'count'
  | 'alphabetical'
  | 'active'
  | 'dimensions'
  | 'aspectRatio'
  | 'megapixels';
export type SortDirection = 'asc' | 'desc';

// Define view types
export type FilterView = 'tag' | 'size' | 'filetype';

/** Emitted by useKeyboardNavigation on Enter; index is global (list-relative,
 *  offset by indexOffset for consumers like the file view's extension list). */
export interface KeyboardSelectEvent {
  index: number;
  shiftKey: boolean;
}

// Define sub-view types for size view
export type SizeSubViewType = 'dimensions' | 'buckets';

// Sort label configuration: [ascLabel, descLabel]
const SORT_LABELS: Record<
  SortType,
  { typeLabel: string; directionLabels: [string, string] }
> = {
  count: { typeLabel: 'Count', directionLabels: ['↑ 0-9', '↓ 9-0'] },
  active: { typeLabel: 'Active', directionLabels: ['↓ Active', '↑ Active'] },
  alphabetical: { typeLabel: 'Name', directionLabels: ['↑ A-Z', '↓ Z-A'] },
  dimensions: { typeLabel: 'Size', directionLabels: ['↑ 0-9', '↓ 9-0'] },
  aspectRatio: {
    typeLabel: 'Ratio',
    directionLabels: ['↑ Tall-Wide', '↓ Wide-Tall'],
  },
  megapixels: { typeLabel: 'Megapixel', directionLabels: ['↑ 0-9', '↓ 9-0'] },
};

// Sort type cycles for each filter view
export const SORT_CYCLES = {
  tag: ['count', 'active', 'alphabetical'] as SortType[],
  filetype: ['count', 'active', 'alphabetical'] as SortType[],
  dimensions: [
    'count',
    'active',
    'dimensions',
    'aspectRatio',
    'megapixels',
  ] as SortType[],
  buckets: ['count', 'active', 'dimensions'] as SortType[],
};

/** Returns display labels and next sort type for the given sort state and cycle */
export const getSortOptions = (
  sortType: SortType,
  sortDirection: SortDirection,
  cycle: SortType[],
) => {
  const labels = SORT_LABELS[sortType] ?? SORT_LABELS.count;
  const [ascLabel, descLabel] = labels.directionLabels;
  const currentIndex = cycle.indexOf(sortType);
  const nextType = cycle[(currentIndex + 1) % cycle.length];

  return {
    typeLabel: labels.typeLabel,
    directionLabel: sortDirection === 'asc' ? ascLabel : descLabel,
    nextType,
  };
};
