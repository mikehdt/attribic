import { useCallback, useMemo } from 'react';

import { selectBucketCounts } from '@/app/store/assets';
import { selectFilterBuckets } from '@/app/store/filters';
import { useAppSelector } from '@/app/store/hooks';
import { decomposeDimensions } from '@/app/utils/helpers';

import { compareByActive } from '../comparators';
import { useFilterContext } from '../filter-context';
import { useFilterListEffects } from '../hooks/use-filter-list-effects';
import { useRangeToggle } from '../use-range-toggle';

export const useBucketsView = () => {
  const bucketCounts = useAppSelector(selectBucketCounts);
  const activeBuckets = useAppSelector(selectFilterBuckets);

  const {
    searchTerm,
    setSearchTerm,
    sortType,
    sortDirection,
    selectedIndex,
    inputRef,
    handleKeyDown,
    handleItemMouseMove,
    handleListMouseLeave,
  } = useFilterContext();

  // Convert to array and apply filtering/sorting
  const bucketList = useMemo(() => {
    let buckets = Object.entries(bucketCounts).map(([bucket, count]) => ({
      name: bucket,
      count,
      isActive: activeBuckets.includes(bucket),
    }));

    // Apply search filter
    if (searchTerm) {
      const filter = searchTerm.toLowerCase().replace('×', 'x');
      buckets = buckets.filter((bucket) => {
        // Normalize the bucket dimensions format for searching (× to x)
        const normalizedBucket = bucket.name.toLowerCase().replace('×', 'x');
        return normalizedBucket.includes(filter);
      });
    }

    // Apply sorting
    buckets.sort((a, b) => {
      if (sortType === 'active') return compareByActive(a, b, sortDirection);

      let result = 0;

      switch (sortType) {
        case 'dimensions': {
          const { width: aWidth, height: aHeight } = decomposeDimensions(
            a.name.replace('×', 'x'),
          );
          const { width: bWidth, height: bHeight } = decomposeDimensions(
            b.name.replace('×', 'x'),
          );
          result = aWidth !== bWidth ? aWidth - bWidth : aHeight - bHeight;
          break;
        }
        default:
          result = a.count - b.count;
      }

      return sortDirection === 'desc' ? -result : result;
    });

    return buckets;
  }, [bucketCounts, activeBuckets, searchTerm, sortType, sortDirection]);

  useFilterListEffects(
    bucketList.length,
    useCallback(
      (index: number) => `bucket-${bucketList[index].name}`,
      [bucketList],
    ),
  );

  // Shift-click / Shift+Return range selection (and plain toggle)
  const { handleItemAction, previewState } = useRangeToggle({
    items: bucketList,
    getValue: (item) => item.name,
    getIsActive: (item) => item.isActive,
    classKey: 'filterBuckets',
  });

  return {
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
  };
};
