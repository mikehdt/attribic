import { memo, useMemo } from 'react';

import {
  calculateKohyaBucket,
  generateBucketList,
} from '@/app/utils/image-utils';

import { includedDimensionHistogram } from './dataset-dimensions';
import type { DatasetSource } from './training-config-form/use-training-config-form';

type KohyaBucketPreviewProps = {
  baseResolution: number;
  datasets: DatasetSource[];
};

/**
 * Informational preview of how the Kohya bucket logic would partition the
 * current dataset at the chosen base resolution. Only meaningful when the
 * selected model uses the Kohya backend.
 */
const KohyaBucketPreviewComponent = ({
  baseResolution,
  datasets,
}: KohyaBucketPreviewProps) => {
  const buckets = useMemo(
    () => generateBucketList(baseResolution),
    [baseResolution],
  );

  // Assign images from dimension histograms to their target buckets. Only the
  // folders the run will train on — a folder switched off still sits in the
  // dataset list, but none of its images reach a bucket.
  const bucketCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [dimKey, count] of Object.entries(
      includedDimensionHistogram(datasets),
    )) {
      const [w, h] = dimKey.split('x').map(Number);
      if (!w || !h) continue;
      const bucket = calculateKohyaBucket(w, h, {
        targetResolution: baseResolution,
        stepSize: 64,
        minSize: 256,
        maxSize: baseResolution * 2,
      });
      const key = `${bucket.width}x${bucket.height}`;
      counts.set(key, (counts.get(key) ?? 0) + count);
    }
    return counts;
  }, [datasets, baseResolution]);

  const hasImageData = bucketCounts.size > 0;

  // Expand buckets to include their portrait mirrors (non-square only), so the
  // preview matches how Kohya actually partitions the dataset.
  const expandedBuckets = useMemo(() => {
    const rows: { w: number; h: number; count: number }[] = [];
    for (const b of buckets) {
      const key = `${b.width}x${b.height}`;
      rows.push({
        w: b.width,
        h: b.height,
        count: bucketCounts.get(key) ?? 0,
      });
      if (b.width !== b.height) {
        const portraitKey = `${b.height}x${b.width}`;
        rows.push({
          w: b.height,
          h: b.width,
          count: bucketCounts.get(portraitKey) ?? 0,
        });
      }
    }
    return rows;
  }, [buckets, bucketCounts]);

  if (buckets.length === 0) return null;

  const visibleRows = hasImageData
    ? expandedBuckets.filter((r) => r.count > 0)
    : expandedBuckets;

  const totalImages = hasImageData
    ? visibleRows.reduce((sum, r) => sum + r.count, 0)
    : 0;

  return (
    <div>
      <p className="text-xs text-slate-400">
        {hasImageData ? (
          <>
            {visibleRows.length}{' '}
            {visibleRows.length === 1 ? 'bucket' : 'buckets'} in use &middot;{' '}
            {totalImages.toLocaleString()}{' '}
            {totalImages === 1 ? 'image' : 'images'}
          </>
        ) : (
          <>
            {expandedBuckets.length} buckets available at {baseResolution}px
          </>
        )}
      </p>
      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-slate-400 tabular-nums">
        {visibleRows.map((r) => (
          <span key={`${r.w}x${r.h}`} className="mr-2">
            {r.w}&times;{r.h}
            {hasImageData && (
              <span className="ml-1 text-sky-500">: {r.count}</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
};

export const KohyaBucketPreview = memo(KohyaBucketPreviewComponent);
