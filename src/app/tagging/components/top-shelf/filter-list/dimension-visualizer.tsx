import { ReactNode } from 'react';

import { decomposeDimensions } from '@/app/utils/helpers';

/**
 * Dimension helpers shared by the Sizes and Buckets views. They live at
 * filter-list level rather than inside `view-sizes/`, which had the Buckets
 * view importing UI out of a sibling view's file.
 */

/** Replaces × with x, so display text and search input match. */
export const normalizeDimensionText = (text: string): string =>
  text.replace('×', 'x');

/** A scaled box showing a size's or bucket's shape at a glance. */
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
