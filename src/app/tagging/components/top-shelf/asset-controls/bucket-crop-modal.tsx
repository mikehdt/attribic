'use client';

import { useCallback, useMemo, useState } from 'react';

import { Checkbox } from '@/app/shared/checkbox';
import { Dropdown } from '@/app/shared/dropdown';
import { FormTitle } from '@/app/shared/form-title/form-title';
import { Input } from '@/app/shared/input/input';
import { Modal } from '@/app/shared/modal';
import { calculateKohyaBucket, KOHYA_CONFIGS } from '@/app/utils/image-utils';

type BucketCropModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export const BucketCropModal = ({ isOpen, onClose }: BucketCropModalProps) => {
  const [inputWidth, setInputWidth] = useState('1024');
  const [inputHeight, setInputHeight] = useState('768');
  const [widthPriority, setWidthPriority] = useState(false);
  const [heightPriority, setHeightPriority] = useState(false);

  // Parse dimensions from inputs, with fallback to defaults
  const dimensions = useMemo(() => {
    const width = parseInt(inputWidth) || 1024;
    const height = parseInt(inputHeight) || 768;
    return { width, height };
  }, [inputWidth, inputHeight]);

  // Calculate bucket for current dimensions
  const bucket = useMemo(() => {
    return calculateKohyaBucket(
      dimensions.width,
      dimensions.height,
      KOHYA_CONFIGS.SDXL_1024,
    );
  }, [dimensions]);

  // Generate all possible buckets for priority constraints
  const allBuckets = useMemo(() => {
    const config = KOHYA_CONFIGS.SDXL_1024;
    const maxArea = config.targetResolution * config.targetResolution;
    const stepSize = config.stepSize;
    const minSize = config.minSize;
    const maxSize = config.maxSize;

    const buckets: Array<{
      width: number;
      height: number;
      aspectRatio: number;
    }> = [];
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

    // Convert to array and sort
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
  }, []);

  // Find valid height options for a given width
  const validHeightsForWidth = useMemo(() => {
    if (!widthPriority) return [];
    const targetWidth = parseInt(inputWidth) || 1024;
    const exactMatches = allBuckets
      .filter((bucket) => bucket.width === targetWidth)
      .map((bucket) => bucket.height)
      .sort((a, b) => a - b);

    // If we have exact matches, return them
    if (exactMatches.length > 0) {
      return exactMatches;
    }

    // Otherwise, find the closest width and return its height options
    const closestWidth = allBuckets.reduce((prev, curr) =>
      Math.abs(curr.width - targetWidth) < Math.abs(prev.width - targetWidth)
        ? curr
        : prev,
    ).width;

    return allBuckets
      .filter((bucket) => bucket.width === closestWidth)
      .map((bucket) => bucket.height)
      .sort((a, b) => a - b);
  }, [widthPriority, inputWidth, allBuckets]);

  // Track if we're showing rounded values for height
  const isHeightRounded = useMemo(() => {
    if (!widthPriority) return false;
    const targetWidth = parseInt(inputWidth) || 1024;
    const exactMatches = allBuckets.filter(
      (bucket) => bucket.width === targetWidth,
    );
    return exactMatches.length === 0;
  }, [widthPriority, inputWidth, allBuckets]);

  // Find valid width options for a given height
  const validWidthsForHeight = useMemo(() => {
    if (!heightPriority) return [];
    const targetHeight = parseInt(inputHeight) || 768;
    const exactMatches = allBuckets
      .filter((bucket) => bucket.height === targetHeight)
      .map((bucket) => bucket.width)
      .sort((a, b) => a - b);

    // If we have exact matches, return them
    if (exactMatches.length > 0) {
      return exactMatches;
    }

    // Otherwise, find the closest height and return its width options
    const closestHeight = allBuckets.reduce((prev, curr) =>
      Math.abs(curr.height - targetHeight) <
      Math.abs(prev.height - targetHeight)
        ? curr
        : prev,
    ).height;

    return allBuckets
      .filter((bucket) => bucket.height === closestHeight)
      .map((bucket) => bucket.width)
      .sort((a, b) => a - b);
  }, [heightPriority, inputHeight, allBuckets]);

  // Track if we're showing rounded values for width
  const isWidthRounded = useMemo(() => {
    if (!heightPriority) return false;
    const targetHeight = parseInt(inputHeight) || 768;
    const exactMatches = allBuckets.filter(
      (bucket) => bucket.height === targetHeight,
    );
    return exactMatches.length === 0;
  }, [heightPriority, inputHeight, allBuckets]);

  // Calculate visualization box dimensions (scale to fit within 400x300)
  const visualizationDimensions = useMemo(() => {
    const maxWidth = 400;
    const maxHeight = 300;

    const scaleX = maxWidth / dimensions.width;
    const scaleY = maxHeight / dimensions.height;
    const scale = Math.min(scaleX, scaleY);

    return {
      width: Math.round(dimensions.width * scale),
      height: Math.round(dimensions.height * scale),
    };
  }, [dimensions]);

  // Calculate crop overlay dimensions for visualization
  const cropVisualization = useMemo(() => {
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
    const cropLeft =
      excessWidth > 0 ? (excessWidth / 2 / scaledWidth) * 100 : 0;
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
  }, [dimensions, bucket]);

  const handleWidthChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newWidth = e.target.value;
      setInputWidth(newWidth);

      // If width priority is enabled, auto-select a valid height for the new width
      if (widthPriority) {
        const targetWidth = parseInt(newWidth) || 1024;
        const validHeights = allBuckets
          .filter((bucket) => bucket.width === targetWidth)
          .map((bucket) => bucket.height)
          .sort((a, b) => a - b);

        if (validHeights.length > 0) {
          const currentHeight = parseInt(inputHeight);
          // If current height is not valid for new width, select first valid height
          if (!validHeights.includes(currentHeight)) {
            setInputHeight(validHeights[0].toString());
          }
        }
      }
    },
    [widthPriority, allBuckets, inputHeight],
  );

  const handleHeightChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newHeight = e.target.value;
      setInputHeight(newHeight);

      // If height priority is enabled, auto-select a valid width for the new height
      if (heightPriority) {
        const targetHeight = parseInt(newHeight) || 768;
        const validWidths = allBuckets
          .filter((bucket) => bucket.height === targetHeight)
          .map((bucket) => bucket.width)
          .sort((a, b) => a - b);

        if (validWidths.length > 0) {
          const currentWidth = parseInt(inputWidth);
          // If current width is not valid for new height, select first valid width
          if (!validWidths.includes(currentWidth)) {
            setInputWidth(validWidths[0].toString());
          }
        }
      }
    },
    [heightPriority, allBuckets, inputWidth],
  );

  const handleWidthPriorityChange = useCallback(() => {
    setWidthPriority((prev) => {
      const newValue = !prev;
      // If enabling width priority, disable height priority
      if (newValue) {
        setHeightPriority(false);
        // Auto-select first valid height for current width
        const targetWidth = parseInt(inputWidth) || 1024;
        const validHeights = allBuckets
          .filter((bucket) => bucket.width === targetWidth)
          .map((bucket) => bucket.height)
          .sort((a, b) => a - b);
        if (validHeights.length > 0) {
          setInputHeight(validHeights[0].toString());
        }
      }
      return newValue;
    });
  }, [inputWidth, allBuckets]);

  const handleHeightPriorityChange = useCallback(() => {
    setHeightPriority((prev) => {
      const newValue = !prev;
      // If enabling height priority, disable width priority
      if (newValue) {
        setWidthPriority(false);
        // Auto-select first valid width for current height
        const targetHeight = parseInt(inputHeight) || 768;
        const validWidths = allBuckets
          .filter((bucket) => bucket.height === targetHeight)
          .map((bucket) => bucket.width)
          .sort((a, b) => a - b);
        if (validWidths.length > 0) {
          setInputWidth(validWidths[0].toString());
        }
      }
      return newValue;
    });
  }, [inputHeight, allBuckets]);

  const handleHeightDropdownChange = useCallback((value: number) => {
    setInputHeight(value.toString());
  }, []);

  const handleWidthDropdownChange = useCallback((value: number) => {
    setInputWidth(value.toString());
  }, []);

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-lg">
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200">
          Bucket Crop Visualisation
        </h2>

        {/* Visualization box */}
        <div className="flex justify-center">
          <div className="relative flex h-80 items-center justify-center">
            <div className="relative">
              <div
                className="border-2 border-slate-300 bg-slate-200"
                style={{
                  width: `${visualizationDimensions.width}px`,
                  height: `${visualizationDimensions.height}px`,
                }}
              >
                {/* Crop overlays */}
                {cropVisualization.top > 0 && (
                  <div
                    className="absolute top-0 right-0 left-0 bg-black/50"
                    style={{ height: `${cropVisualization.top}%` }}
                  />
                )}
                {cropVisualization.bottom > 0 && (
                  <div
                    className="absolute right-0 bottom-0 left-0 bg-black/50"
                    style={{ height: `${cropVisualization.bottom}%` }}
                  />
                )}
                {cropVisualization.left > 0 && (
                  <div
                    className="absolute top-0 bottom-0 left-0 bg-black/50"
                    style={{ width: `${cropVisualization.left}%` }}
                  />
                )}
                {cropVisualization.right > 0 && (
                  <div
                    className="absolute top-0 right-0 bottom-0 bg-black/50"
                    style={{ width: `${cropVisualization.right}%` }}
                  />
                )}

                {/* Kept area border */}
                <div
                  className="absolute border-2 border-dotted border-white/80"
                  style={{
                    top: `${cropVisualization.top}%`,
                    bottom: `${cropVisualization.bottom}%`,
                    left: `${cropVisualization.left}%`,
                    right: `${cropVisualization.right}%`,
                  }}
                />
              </div>

              {/* Dimension labels */}
              <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-center text-xs whitespace-nowrap text-slate-500">
                {dimensions.width} &times; {dimensions.height}
              </div>
            </div>
          </div>
        </div>

        {/* Input controls */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="mb-2 flex items-center justify-between px-3">
              <FormTitle htmlFor="width-input" variant="section">
                Width
              </FormTitle>
              <Checkbox
                isSelected={widthPriority}
                onChange={handleWidthPriorityChange}
                label="Priority"
                size="sm"
              />
            </div>
            {heightPriority ? (
              validWidthsForHeight.length === 1 ? (
                <div className="flex items-center rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  {validWidthsForHeight[0]}
                  {isWidthRounded && (
                    <span className="ml-1 text-xs text-amber-600">
                      (rounded)
                    </span>
                  )}
                </div>
              ) : (
                <Dropdown
                  openUpward
                  fullWidth
                  size="lg"
                  items={validWidthsForHeight.map((width) => ({
                    value: width,
                    label: isWidthRounded
                      ? `${width} (rounded)`
                      : width.toString(),
                  }))}
                  selectedValue={
                    validWidthsForHeight.includes(parseInt(inputWidth))
                      ? parseInt(inputWidth)
                      : validWidthsForHeight[0]
                  }
                  onChange={handleWidthDropdownChange}
                />
              )
            ) : (
              <Input
                id="width-input"
                type="number"
                value={inputWidth}
                onChange={handleWidthChange}
                className="w-full"
                min={1}
                max={4096}
              />
            )}
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between px-3">
              <FormTitle htmlFor="height-input" variant="section">
                Height
              </FormTitle>
              <Checkbox
                isSelected={heightPriority}
                onChange={handleHeightPriorityChange}
                label="Priority"
                size="sm"
              />
            </div>
            {widthPriority ? (
              validHeightsForWidth.length === 1 ? (
                <div className="flex items-center rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  {validHeightsForWidth[0]}
                  {isHeightRounded && (
                    <span className="ml-1 text-xs text-amber-600">
                      (rounded)
                    </span>
                  )}
                </div>
              ) : (
                <Dropdown
                  openUpward
                  fullWidth
                  size="lg"
                  items={validHeightsForWidth.map((height) => ({
                    value: height,
                    label: isHeightRounded
                      ? `${height} (rounded)`
                      : height.toString(),
                  }))}
                  selectedValue={
                    validHeightsForWidth.includes(parseInt(inputHeight))
                      ? parseInt(inputHeight)
                      : validHeightsForWidth[0]
                  }
                  onChange={handleHeightDropdownChange}
                />
              )
            ) : (
              <Input
                id="height-input"
                type="number"
                value={inputHeight}
                onChange={handleHeightChange}
                className="w-full"
                min={1}
                max={4096}
              />
            )}
          </div>
        </div>

        {/* Calculated bucket info */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-950 dark:bg-slate-900">
          <FormTitle as="span" variant="section">
            Calculated Bucket
          </FormTitle>

          <div className="mt-2 text-sm text-slate-600 tabular-nums dark:text-slate-300">
            <p>
              <span className="font-bold">Dimensions:</span> {bucket.width} ×{' '}
              {bucket.height}
            </p>
            <p>
              <span className="font-bold">Aspect Ratio:</span>{' '}
              {bucket.aspectRatio.toFixed(3)}
            </p>
          </div>
        </div>
      </div>
    </Modal>
  );
};
