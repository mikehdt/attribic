import { useCallback, useMemo, useState } from 'react';

import { calculateKohyaBucket, KOHYA_CONFIGS } from '@/app/utils/image-utils';

import {
  computeCropVisualization,
  computeVisualizationDimensions,
  type DimensionAxis,
  generateAllBuckets,
  getAxisOptions,
  getExactAxisMatches,
} from './bucket-crop-modal-maths';

const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 768;

export const useBucketCropModal = () => {
  const [inputWidth, setInputWidth] = useState(DEFAULT_WIDTH.toString());
  const [inputHeight, setInputHeight] = useState(DEFAULT_HEIGHT.toString());
  const [widthPriority, setWidthPriority] = useState(false);
  const [heightPriority, setHeightPriority] = useState(false);

  // Parse dimensions from inputs, with fallback to defaults
  const dimensions = useMemo(() => {
    const width = parseInt(inputWidth, 10) || DEFAULT_WIDTH;
    const height = parseInt(inputHeight, 10) || DEFAULT_HEIGHT;
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
  const allBuckets = useMemo(() => generateAllBuckets(), []);

  // Valid height options (+ rounding flag) for the current width, when width has priority
  const { values: validHeightsForWidth, isRounded: isHeightRounded } =
    useMemo(() => {
      if (!widthPriority) return { values: [], isRounded: false };
      const targetWidth = parseInt(inputWidth, 10) || DEFAULT_WIDTH;
      return getAxisOptions(allBuckets, 'width', targetWidth);
    }, [widthPriority, inputWidth, allBuckets]);

  // Valid width options (+ rounding flag) for the current height, when height has priority
  const { values: validWidthsForHeight, isRounded: isWidthRounded } =
    useMemo(() => {
      if (!heightPriority) return { values: [], isRounded: false };
      const targetHeight = parseInt(inputHeight, 10) || DEFAULT_HEIGHT;
      return getAxisOptions(allBuckets, 'height', targetHeight);
    }, [heightPriority, inputHeight, allBuckets]);

  // Calculate visualization box dimensions (scale to fit within 400x300)
  const visualizationDimensions = useMemo(
    () => computeVisualizationDimensions(dimensions),
    [dimensions],
  );

  // Calculate crop overlay dimensions for visualization
  const cropVisualization = useMemo(
    () => computeCropVisualization(dimensions, bucket),
    [dimensions, bucket],
  );

  // Axis-parameterised implementation shared by the width and height inputs:
  // updates this axis's value, and — when this axis has priority — auto-selects
  // a valid value for the other axis if the current one is no longer valid
  const handleDimensionChange = useCallback(
    (axis: DimensionAxis, rawValue: string) => {
      const isWidthAxis = axis === 'width';
      const setValue = isWidthAxis ? setInputWidth : setInputHeight;
      const hasPriority = isWidthAxis ? widthPriority : heightPriority;
      const otherValue = isWidthAxis ? inputHeight : inputWidth;
      const setOtherValue = isWidthAxis ? setInputHeight : setInputWidth;
      const defaultValue = isWidthAxis ? DEFAULT_WIDTH : DEFAULT_HEIGHT;

      setValue(rawValue);

      if (hasPriority) {
        const targetValue = parseInt(rawValue, 10) || defaultValue;
        const validOptions = getExactAxisMatches(allBuckets, axis, targetValue);

        if (validOptions.length > 0) {
          const currentOtherValue = parseInt(otherValue, 10);
          // If the other axis's current value is no longer valid for the new
          // value, select the first valid option
          if (!validOptions.includes(currentOtherValue)) {
            setOtherValue(validOptions[0].toString());
          }
        }
      }
    },
    [widthPriority, heightPriority, inputWidth, inputHeight, allBuckets],
  );

  const handleWidthChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) =>
      handleDimensionChange('width', e.target.value),
    [handleDimensionChange],
  );

  const handleHeightChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) =>
      handleDimensionChange('height', e.target.value),
    [handleDimensionChange],
  );

  // Axis-parameterised implementation shared by the width and height priority
  // toggles: enabling one axis's priority disables the other's, and
  // auto-selects the first valid value for the other axis
  const handleDimensionPriorityChange = useCallback(
    (axis: DimensionAxis) => {
      const isWidthAxis = axis === 'width';
      const setPriority = isWidthAxis ? setWidthPriority : setHeightPriority;
      const setOtherPriority = isWidthAxis
        ? setHeightPriority
        : setWidthPriority;
      const value = isWidthAxis ? inputWidth : inputHeight;
      const setOtherValue = isWidthAxis ? setInputHeight : setInputWidth;
      const defaultValue = isWidthAxis ? DEFAULT_WIDTH : DEFAULT_HEIGHT;

      setPriority((prev) => {
        const newValue = !prev;
        // If enabling this axis's priority, disable the other axis's
        if (newValue) {
          setOtherPriority(false);
          // Auto-select first valid value for the other axis
          const targetValue = parseInt(value, 10) || defaultValue;
          const validOptions = getExactAxisMatches(
            allBuckets,
            axis,
            targetValue,
          );
          if (validOptions.length > 0) {
            setOtherValue(validOptions[0].toString());
          }
        }
        return newValue;
      });
    },
    [inputWidth, inputHeight, allBuckets],
  );

  const handleWidthPriorityChange = useCallback(
    () => handleDimensionPriorityChange('width'),
    [handleDimensionPriorityChange],
  );

  const handleHeightPriorityChange = useCallback(
    () => handleDimensionPriorityChange('height'),
    [handleDimensionPriorityChange],
  );

  // Axis-parameterised implementation shared by the width and height dropdowns
  const handleDimensionDropdownChange = useCallback(
    (axis: DimensionAxis, value: number) => {
      const setValue = axis === 'width' ? setInputWidth : setInputHeight;
      setValue(value.toString());
    },
    [],
  );

  const handleWidthDropdownChange = useCallback(
    (value: number) => handleDimensionDropdownChange('width', value),
    [handleDimensionDropdownChange],
  );

  const handleHeightDropdownChange = useCallback(
    (value: number) => handleDimensionDropdownChange('height', value),
    [handleDimensionDropdownChange],
  );

  return {
    inputWidth,
    inputHeight,
    widthPriority,
    heightPriority,
    dimensions,
    bucket,
    visualizationDimensions,
    cropVisualization,
    validHeightsForWidth,
    isHeightRounded,
    validWidthsForHeight,
    isWidthRounded,
    handleWidthChange,
    handleHeightChange,
    handleWidthPriorityChange,
    handleHeightPriorityChange,
    handleWidthDropdownChange,
    handleHeightDropdownChange,
  };
};
