import { memo, useMemo } from 'react';

import type { DatasetSource } from './training-config-form/use-training-config-form';

type NativeResolutionPreviewProps = {
  width: number;
  height: number;
  datasets: DatasetSource[];
};

/**
 * Replaces the bucket preview when an exact WxH training size is set. Bucketing
 * is off in that mode, so sd-scripts resizes and centre-crops anything that
 * isn't already the target size — this surfaces how many images that hits,
 * which is otherwise silent.
 */
const NativeResolutionPreviewComponent = ({
  width,
  height,
  datasets,
}: NativeResolutionPreviewProps) => {
  const { matching, total } = useMemo(() => {
    const target = `${width}x${height}`;
    let matched = 0;
    let seen = 0;
    for (const ds of datasets) {
      if (!ds.dimensionHistogram) continue;
      for (const [dimKey, count] of Object.entries(ds.dimensionHistogram)) {
        seen += count;
        if (dimKey === target) matched += count;
      }
    }
    return { matching: matched, total: seen };
  }, [datasets, width, height]);

  const mismatched = total - matching;

  return (
    <div>
      <p className="text-xs text-slate-400">
        Bucketing off &middot; every image trains at{' '}
        <span className="text-(--foreground)/70 tabular-nums">
          {width}&times;{height}
        </span>
      </p>
      {total > 0 && (
        <p className="mt-1 text-xs">
          {mismatched === 0 ? (
            <span className="text-emerald-500">
              All {total.toLocaleString()}{' '}
              {total === 1 ? 'image is' : 'images are'} the correct size
            </span>
          ) : (
            <span className="text-amber-500">
              {mismatched.toLocaleString()} of {total.toLocaleString()}{' '}
              {mismatched === 1 ? 'image isn’t' : 'images aren’t'} {width}
              &times;{height} — {mismatched === 1 ? 'it' : 'they'} will be
              resized and centre-cropped
            </span>
          )}
        </p>
      )}
    </div>
  );
};

export const NativeResolutionPreview = memo(NativeResolutionPreviewComponent);
