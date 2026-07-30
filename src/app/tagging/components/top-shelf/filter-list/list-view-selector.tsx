import { XIcon } from 'lucide-react';
import { useMemo } from 'react';

import { SegmentedControl } from '@/app/shared/segmented-control/segmented-control';
import { useAppSelector } from '@/app/store/hooks';
import { selectCaptionMode } from '@/app/store/project';

import { useFilterContext } from './filter-context';
import { FilterView } from './types';

const allViewOptions: { value: FilterView; label: string }[] = [
  { value: 'tag', label: 'Tag' },
  { value: 'size', label: 'Size' },
  { value: 'filetype', label: 'File' },
];

export const ViewSelector = () => {
  const { activeView, setActiveView, onClose } = useFilterContext();

  const captionMode = useAppSelector(selectCaptionMode);

  // Hide the Tag view in caption mode — comma-split fragments aren't useful
  const viewOptions = useMemo(
    () =>
      captionMode === 'caption'
        ? allViewOptions.filter((o) => o.value !== 'tag')
        : allViewOptions,
    [captionMode],
  );

  return (
    <>
      <SegmentedControl
        options={viewOptions}
        value={activeView}
        // The context's setter is `handleViewChange` — it already clears the
        // search term, keyboard index and range anchor. Clearing them again
        // here just meant two places to keep in step.
        onChange={setActiveView}
        tone="surface"
        width="full"
      />

      <button
        onClick={onClose}
        className="ml-2 cursor-pointer rounded-full p-1 transition-colors hover:bg-slate-200 dark:hover:bg-slate-600"
        title="Close filter list"
      >
        <XIcon className="h-4 w-4" />
      </button>
    </>
  );
};
