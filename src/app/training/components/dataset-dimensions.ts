import type { DatasetSource } from './training-config-form/use-training-config-form';

/**
 * Image sizes across the folders a run will actually train on, as
 * `{ '1024x1024': 12, '1280x720': 3 }`.
 *
 * A folder with its repeats set to 0 is dropped by the request builder, so it
 * is dropped here too: the bucket and native-resolution previews exist to
 * describe the run about to be launched, and counting excluded images into
 * them describes a different one.
 *
 * Extra folders live outside the projects root and are never dimension-scanned,
 * so they contribute nothing here whether they're included or not.
 */
export function includedDimensionHistogram(
  datasets: DatasetSource[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const ds of datasets) {
    if (!ds.folderHistograms) continue;
    for (const folder of ds.folders) {
      const repeats = folder.overrideRepeats ?? folder.detectedRepeats;
      if (repeats <= 0) continue;
      const histogram = ds.folderHistograms[folder.name];
      if (!histogram) continue;
      for (const [dimKey, count] of Object.entries(histogram)) {
        totals[dimKey] = (totals[dimKey] ?? 0) + count;
      }
    }
  }
  return totals;
}
