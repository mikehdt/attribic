'use client';

import { Checkbox } from '@/app/shared/checkbox';
import { Dropdown } from '@/app/shared/dropdown';
import { FormTitle } from '@/app/shared/form-title/form-title';
import { Input } from '@/app/shared/input/input';
import { Modal } from '@/app/shared/modal';

import { useBucketCropModal } from './use-bucket-crop-modal';

type BucketCropModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export const BucketCropModal = ({ isOpen, onClose }: BucketCropModalProps) => {
  const {
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
  } = useBucketCropModal();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="max-w-lg"
      labelledById="bucket-crop-modal-title"
    >
      <div className="space-y-4">
        <h2
          id="bucket-crop-modal-title"
          className="text-2xl font-semibold text-slate-700 dark:text-slate-200"
        >
          Bucket Crop Visualisation
        </h2>

        {/* Visualization box */}
        <div className="flex justify-center">
          <div className="relative flex h-80 items-center justify-center">
            <div className="relative">
              <div
                className="border-2 border-slate-300 bg-slate-200 dark:border-slate-600 dark:bg-slate-700"
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
              <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-center text-sm whitespace-nowrap text-slate-500 dark:text-slate-400">
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
                <div className="flex items-center rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300">
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
                    validWidthsForHeight.includes(parseInt(inputWidth, 10))
                      ? parseInt(inputWidth, 10)
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
                <div className="flex items-center rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300">
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
                    validHeightsForWidth.includes(parseInt(inputHeight, 10))
                      ? parseInt(inputHeight, 10)
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
