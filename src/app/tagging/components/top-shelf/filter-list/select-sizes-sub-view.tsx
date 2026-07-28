import { SegmentedControl } from '@/app/shared/segmented-control/segmented-control';

import { useFilterContext } from './filter-context';
import { SizeSubViewType } from './types';
import { BucketsView } from './view-buckets/view-buckets';
import { SizesView } from './view-sizes/view-sizes';

const subViewOptions: { value: SizeSubViewType; label: string }[] = [
  { value: 'dimensions', label: 'Images' },
  { value: 'buckets', label: 'Buckets' },
];

export const SizeSubViewSelector = () => {
  const {
    sizeSubView,
    setSizeSubView,
    setSearchTerm,
    setSelectedIndex,
    inputRef,
  } = useFilterContext();

  const handleSubViewChange = (subView: SizeSubViewType) => {
    setSizeSubView(subView);
    // Clear search and reset selection when switching sub-views. No sort reset
    // is needed: each sub-view keeps its own sort state, and the buckets sort
    // cycle only ever contains types valid for buckets.
    setSearchTerm('');
    setSelectedIndex(-1);

    // Focus the search input after a short delay to ensure it's rendered
    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    });
  };

  return (
    <SegmentedControl
      options={subViewOptions}
      value={sizeSubView}
      onChange={handleSubViewChange}
      width="full"
      tone="surface"
    />
  );
};

// Component render
export const SizeSubView = () => {
  const { sizeSubView } = useFilterContext();

  return sizeSubView === 'dimensions' ? <SizesView /> : <BucketsView />;
};
