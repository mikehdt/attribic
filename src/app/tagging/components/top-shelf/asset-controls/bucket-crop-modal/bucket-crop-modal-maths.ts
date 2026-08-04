import { KOHYA_CONFIGS } from '@/app/utils/image-utils';

export type DimensionAxis = 'width' | 'height';

export type Dimensions = {
  width: number;
  height: number;
};

export type BucketOption = {
  width: number;
  height: number;
  aspectRatio: number;
};

export type AxisOptions = {
  values: number[];
  isRounded: boolean;
};

export type CropVisualization = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

/**
 * Generate all possible Kohya SDXL_1024 buckets, both orientations, sorted
 * by width then height. Used to constrain the "priority" axis dropdowns.
 */
export const generateAllBuckets = (): BucketOption[] => {
  const config = KOHYA_CONFIGS.SDXL_1024;
  const maxArea = config.targetResolution * config.targetResolution;
  const stepSize = config.stepSize;
  const minSize = config.minSize;
  const maxSize = config.maxSize;

  const buckets: BucketOption[] = [];
  const resos = new Set<string>();

  // Add the square resolution first
  const squareWidth = Math.floor(Math.sqrt(maxArea) / stepSize) * stepSize;
  resos.add(`${squareWidth}x${squareWidth}`);

  // Generate buckets by iterating through widths
  let width = minSize;
  while (width <= maxSize) {
    const idealHeight = maxArea / width;
    const height = Math.min(
      maxSize,
      Math.floor(idealHeight / stepSize) * stepSize,
    );

    if (height >= minSize) {
      resos.add(`${width}x${height}`);
      resos.add(`${height}x${width}`);
    }

    width += stepSize;
  }

  for (const reso of resos) {
    const [w, h] = reso.split('x').map(Number);
    buckets.push({
      width: w,
      height: h,
      aspectRatio: w / h,
    });
  }

  buckets.sort((a, b) => {
    if (a.width !== b.width) return a.width - b.width;
    return a.height - b.height;
  });

  return buckets;
};

/**
 * Sorted values of the axis opposite `axis` for buckets that match
 * `targetValue` on `axis` exactly. Empty when there is no exact match.
 */
export const getExactAxisMatches = (
  buckets: BucketOption[],
  axis: DimensionAxis,
  targetValue: number,
): number[] => {
  const otherAxis: DimensionAxis = axis === 'width' ? 'height' : 'width';
  return buckets
    .filter((bucket) => bucket[axis] === targetValue)
    .map((bucket) => bucket[otherAxis])
    .sort((a, b) => a - b);
};

/**
 * Valid opposite-axis values for `targetValue` on `axis`, falling back to
 * the closest bucket on `axis` (flagging `isRounded`) when there's no exact
 * match.
 */
export const getAxisOptions = (
  buckets: BucketOption[],
  axis: DimensionAxis,
  targetValue: number,
): AxisOptions => {
  const exactMatches = getExactAxisMatches(buckets, axis, targetValue);
  if (exactMatches.length > 0) {
    return { values: exactMatches, isRounded: false };
  }

  const closestValue = buckets.reduce((prev, curr) =>
    Math.abs(curr[axis] - targetValue) < Math.abs(prev[axis] - targetValue)
      ? curr
      : prev,
  )[axis];

  return {
    values: getExactAxisMatches(buckets, axis, closestValue),
    isRounded: true,
  };
};

/** Scale dimensions to fit within the 400x300 visualisation box. */
export const computeVisualizationDimensions = (
  dimensions: Dimensions,
): Dimensions => {
  const maxWidth = 400;
  const maxHeight = 300;

  const scaleX = maxWidth / dimensions.width;
  const scaleY = maxHeight / dimensions.height;
  const scale = Math.min(scaleX, scaleY);

  return {
    width: Math.round(dimensions.width * scale),
    height: Math.round(dimensions.height * scale),
  };
};

/** Crop overlay percentages for the visualisation box, given the bucket the image will be fit into. */
export const computeCropVisualization = (
  dimensions: Dimensions,
  bucket: BucketOption,
): CropVisualization => {
  // Calculate scale factor to fill the bucket
  const scaleToFillWidth = bucket.width / dimensions.width;
  const scaleToFillHeight = bucket.height / dimensions.height;
  const scale = Math.max(scaleToFillWidth, scaleToFillHeight);

  // Calculate scaled dimensions
  const scaledWidth = dimensions.width * scale;
  const scaledHeight = dimensions.height * scale;

  // Calculate how much gets cropped off each side
  const excessWidth = Math.max(0, scaledWidth - bucket.width);
  const excessHeight = Math.max(0, scaledHeight - bucket.height);

  // Convert to percentages of the visualization box
  const cropLeft = excessWidth > 0 ? (excessWidth / 2 / scaledWidth) * 100 : 0;
  const cropRight = cropLeft;
  const cropTop =
    excessHeight > 0 ? (excessHeight / 2 / scaledHeight) * 100 : 0;
  const cropBottom = cropTop;

  return {
    top: cropTop,
    bottom: cropBottom,
    left: cropLeft,
    right: cropRight,
  };
};
