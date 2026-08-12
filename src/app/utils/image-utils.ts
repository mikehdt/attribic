export type ImageSizeConstraints = {
  /** Cap on the served width, px. Aspect ratio is preserved (fit inside). */
  maxWidth?: number;
  /** Cap on the served height, px. Aspect ratio is preserved (fit inside). */
  maxHeight?: number;
};

/**
 * Generate a URL for an image that can be used with Next.js Image component
 * This works with images from any folder on disk via our API route.
 *
 * Optional constraints ask the route for a downscaled preview (never
 * enlarged); omit them for the original file. Videos ignore the constraints
 * server-side.
 */
export const getImageUrl = (
  fileName: string,
  projectName?: string,
  constraints?: ImageSizeConstraints,
): string => {
  if (!projectName) {
    // Fallback to public/assets for backward compatibility
    return `/assets/${fileName}`;
  }

  // Use our API route to serve images from any folder
  // Pass just the project name, not the full path
  const encodedProjectName = encodeURIComponent(projectName);
  const encodedFileName = encodeURIComponent(fileName);

  let url = `/api/images/${encodedFileName}?projectName=${encodedProjectName}`;
  if (constraints?.maxWidth) url += `&w=${constraints.maxWidth}`;
  if (constraints?.maxHeight) url += `&h=${constraints.maxHeight}`;

  return url;
};

/**
 * Kohya SS model configurations for different Stable Diffusion versions
 */
type KohyaConfig = {
  targetResolution: number; // Base resolution (e.g., 512, 768, 1024)
  stepSize: number; // Increment size (typically 64)
  minSize: number; // Minimum bucket dimension
  maxSize: number; // Maximum bucket dimension
};

export const KOHYA_CONFIGS = {
  SD15: {
    targetResolution: 512,
    stepSize: 64,
    minSize: 256,
    maxSize: 768,
  } as KohyaConfig,
  SDXL_768: {
    targetResolution: 768,
    stepSize: 64,
    minSize: 256,
    maxSize: 1024,
  } as KohyaConfig,
  SDXL_1024: {
    targetResolution: 1024,
    stepSize: 64,
    minSize: 256,
    maxSize: 2048,
  } as KohyaConfig,
} as const;

/**
 * Generate all Kohya-style resolution buckets for a given base resolution.
 * Buckets maintain approximately the same pixel area (targetResolution²)
 * with dimensions in step-size increments. Returns only landscape-or-square
 * pairs (width >= height); portrait is the transpose.
 */
export function generateBucketList(
  targetResolution: number,
  stepSize = 64,
  minSize = 256,
  maxSize = targetResolution * 2,
): { width: number; height: number }[] {
  const maxArea = targetResolution * targetResolution;
  const resos = new Set<string>();

  const squareSide = Math.floor(Math.sqrt(maxArea) / stepSize) * stepSize;
  resos.add(`${squareSide}x${squareSide}`);

  let w = minSize;
  while (w <= maxSize) {
    const h = Math.min(maxSize, Math.floor(maxArea / w / stepSize) * stepSize);
    if (h >= minSize) {
      // Store landscape only (w >= h); caller can transpose for portrait
      if (w >= h) resos.add(`${w}x${h}`);
      else resos.add(`${h}x${w}`);
    }
    w += stepSize;
  }

  return Array.from(resos)
    .map((r) => {
      const [bw, bh] = r.split('x').map(Number);
      return { width: bw, height: bh };
    })
    .sort((a, b) => a.width / a.height - b.width / b.height);
}

/**
 * Calculate the Kohya SS bucket dimensions for a given image
 * Based on the actual Kohya SS bucketing logic from make_bucket_resolutions():
 * - Buckets are generated with area constraint (width * height = targetResolution²)
 * - Buckets are in step-size increments (typically 64px)
 * - Images are assigned to the bucket with the closest aspect ratio
 */
export const calculateKohyaBucket = (
  imageWidth: number,
  imageHeight: number,
  config: KohyaConfig = KOHYA_CONFIGS.SDXL_1024, // Default to SDXL 1024
): { width: number; height: number; aspectRatio: number } => {
  const maxArea = config.targetResolution * config.targetResolution;
  const stepSize = config.stepSize;
  const minSize = config.minSize;
  const maxSize = config.maxSize;

  // Generate all possible bucket resolutions using Kohya's exact algorithm
  const resos = new Set<string>(); // Use Set to avoid duplicates, store as strings

  // Add the square resolution first
  const squareWidth = Math.floor(Math.sqrt(maxArea) / stepSize) * stepSize;
  resos.add(`${squareWidth}x${squareWidth}`);

  // Generate buckets by iterating through widths
  let width = minSize;
  while (width <= maxSize) {
    // Calculate height to maintain max area
    const idealHeight = maxArea / width;
    const height = Math.min(
      maxSize,
      Math.floor(idealHeight / stepSize) * stepSize,
    );

    if (height >= minSize) {
      // Add both orientations (width×height and height×width)
      resos.add(`${width}x${height}`);
      resos.add(`${height}x${width}`);
    }

    width += stepSize;
  }

  // Convert back to array of bucket objects
  const buckets: Array<{ width: number; height: number; aspectRatio: number }> =
    [];
  for (const reso of resos) {
    const [w, h] = reso.split('x').map(Number);
    buckets.push({
      width: w,
      height: h,
      aspectRatio: w / h,
    });
  }

  // Sort buckets (to match Kohya's behavior)
  buckets.sort((a, b) => {
    if (a.width !== b.width) return a.width - b.width;
    return a.height - b.height;
  });

  // Find bucket with closest aspect ratio to the image
  const imageAspectRatio = imageWidth / imageHeight;
  let bestBucket = buckets[0];
  let smallestAspectRatioError = Math.abs(
    bestBucket.aspectRatio - imageAspectRatio,
  );

  for (const bucket of buckets) {
    const aspectRatioError = Math.abs(bucket.aspectRatio - imageAspectRatio);
    if (aspectRatioError < smallestAspectRatioError) {
      smallestAspectRatioError = aspectRatioError;
      bestBucket = bucket;
    }
  }

  return {
    width: bestBucket.width,
    height: bestBucket.height,
    aspectRatio: bestBucket.aspectRatio,
  };
};

/**
 * Examples of convenience functions for specific Stable Diffusion versions
 */
// export const calculateSD15Bucket = (imageWidth: number, imageHeight: number) =>
//   calculateKohyaBucket(imageWidth, imageHeight, KOHYA_CONFIGS.SD15);

// export const calculateSDXL768Bucket = (
//   imageWidth: number,
//   imageHeight: number,
// ) => calculateKohyaBucket(imageWidth, imageHeight, KOHYA_CONFIGS.SDXL_768);

// export const calculateSDXL1024Bucket = (
//   imageWidth: number,
//   imageHeight: number,
// ) => calculateKohyaBucket(imageWidth, imageHeight, KOHYA_CONFIGS.SDXL_1024);
