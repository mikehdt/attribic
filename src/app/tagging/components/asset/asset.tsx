import { EyeIcon, EyeOffIcon } from 'lucide-react';
import Image from 'next/image';
import { memo, MouseEvent, useCallback, useState } from 'react';

import { isSupportedVideoExtension } from '@/app/constants';
import { Button } from '@/app/shared/button';
import { Checkbox } from '@/app/shared/checkbox';
import { ImageDimensions, IoState, KohyaBucket } from '@/app/store/assets';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import {
  selectCaptionMode,
  selectProjectFolderName,
  selectShowCropVisualization,
} from '@/app/store/project';
import {
  adoptCurrentAssetAsRangeAnchor,
  handleAssetClick,
  selectAssetIsCurrent,
  selectAssetIsSelected,
  setCurrentAsset,
  setShiftHoverAssetId,
} from '@/app/store/selection';
import { handleEditorEscape } from '@/app/tagging/views/asset-gallery/editor-focus';
import { useZoomKey } from '@/app/tagging/views/asset-gallery/use-zoom-key';
import { composeDimensions, getAspectRatio } from '@/app/utils/helpers';
import { getImageUrl } from '@/app/utils/image-utils';
import { isArchiveSubfolder } from '@/app/utils/subfolder-utils';

import { CaptionManager } from '../tagging/caption-manager';
import { HybridManager } from '../tagging/hybrid-manager';
import { TaggingManager } from '../tagging/tagging-manager';
import { AssetMetadata } from './asset-metadata';
import { CropVisualization } from './crop-visualization';

type PreviewState = 'select' | 'deselect' | null;

// Longest-edge cap for the row image. Un-zoomed rows render at max-h-64, but
// the zoomed state can reach 3/4 of a full-bleed row, so the cap is sized for
// zoom — one URL for both states, so toggling never refetches. A 4K landscape
// serves at 1920×1080; bump if zoom looks soft on very wide displays.
const ROW_PREVIEW_PX = 1920;

type AssetProps = {
  assetId: string;
  fileExtension: string;
  subfolder?: string;
  filteredIndex: number;
  dimensions: ImageDimensions;
  bucket: KohyaBucket;
  ioState: IoState;
  lastModified: number;
  blurDataUrl?: string;
  currentPage: number;
  // Shift-hover preview state
  previewState?: PreviewState;
  onHover?: (assetId: string | null) => void;
};

const AssetComponent = ({
  assetId,
  fileExtension,
  subfolder,
  filteredIndex,
  dimensions,
  bucket,
  ioState,
  lastModified,
  blurDataUrl,
  currentPage,
  previewState,
  onHover,
}: AssetProps) => {
  const [imageZoom, setImageZoom] = useState<boolean>(false);
  // Local override for crop visualization - resets when global state changes
  const [localCropOverride, setLocalCropOverride] = useState<boolean | null>(
    null,
  );
  // Track the last global value to detect changes
  const [lastGlobalValue, setLastGlobalValue] = useState<boolean | null>(null);

  const dispatch = useAppDispatch();
  const isSelected = useAppSelector((state) =>
    selectAssetIsSelected(state, assetId),
  );
  const isCurrent = useAppSelector((state) =>
    selectAssetIsCurrent(state, assetId),
  );
  const globalShowCropVisualization = useAppSelector(
    selectShowCropVisualization,
  );
  const captionMode = useAppSelector(selectCaptionMode);

  // Reset local override when global state changes (derived state pattern)
  if (globalShowCropVisualization !== lastGlobalValue) {
    setLastGlobalValue(globalShowCropVisualization);
    if (localCropOverride !== null) {
      setLocalCropOverride(null);
    }
  }

  // Determine effective crop visualization state (local override takes precedence)
  const showCropVisualization =
    localCropOverride ?? globalShowCropVisualization;

  const isVideo = isSupportedVideoExtension(`.${fileExtension}`);

  // Determine if cropping would occur (when aspect ratios don't match).
  // Videos don't participate in bucket/crop logic.
  const wouldCrop =
    !isVideo &&
    dimensions.width / dimensions.height !== bucket.width / bucket.height;

  const dimensionsComposed = composeDimensions(dimensions);

  // Get the image URL for the current project with cache busting
  const projectName = useAppSelector(selectProjectFolderName);
  const fileName = `${assetId}.${fileExtension}`;
  const baseUrl = getImageUrl(
    fileName,
    projectName || undefined,
    isVideo
      ? undefined
      : { maxWidth: ROW_PREVIEW_PX, maxHeight: ROW_PREVIEW_PX },
  );
  const imageUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}t=${lastModified}`;

  const toggleImageZoom = useCallback(() => {
    setImageZoom((prev) => !prev);
  }, []);

  // z zooms the current row's image, mirroring a click on it
  useZoomKey(isCurrent, toggleImageZoom);

  // Stops propagation so the nested checkbox and the strip around it don't
  // both toggle, which means the row's own click handler never sees this —
  // the highlight has to move from here instead
  const onToggleAssetSelection = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      // Prevent text selection when shift+clicking
      if (e.shiftKey) {
        e.preventDefault();
      }
      dispatch(
        handleAssetClick({
          assetId,
          isShiftHeld: e.shiftKey,
          currentPage,
        }),
      );
      if (!isCurrent) {
        dispatch(setCurrentAsset(assetId));
      }
    },
    [assetId, currentPage, dispatch, isCurrent],
  );

  const onToggleLocalCropVisualization = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      setLocalCropOverride((prev) =>
        prev === null ? !globalShowCropVisualization : !prev,
      );
    },
    [globalShowCropVisualization],
  );

  // Hover handlers for shift-hover preview
  const handleMouseEnter = useCallback(() => {
    onHover?.(assetId);
  }, [onHover, assetId]);

  const handleMouseLeave = useCallback(() => {
    onHover?.(null);
  }, [onHover]);

  // Determine visual state: preview overrides actual selection for display
  // previewState 'select' means "would become selected" (show as selected)
  // previewState 'deselect' means "would become deselected" (show as deselected)
  const showAsSelected =
    previewState === 'select'
      ? true
      : previewState === 'deselect'
        ? false
        : isSelected;
  const isPreview = previewState !== null && previewState !== undefined;

  // Build class names for the selection panel
  const selectionPanelClasses = `flex cursor-pointer select-none flex-col justify-between px-1 pt-1 pb-2 inset-shadow-sm inset-shadow-(--surface-elevated) transition-colors max-md:flex-row max-md:px-2 max-md:pb-1 md:border-r md:border-r-(--border) ${
    showAsSelected
      ? isPreview
        ? 'bg-(--selected-bg-preview) text-(--selected-text-preview)' // Lighter purple for preview-select
        : 'bg-(--selected-bg) text-(--selected-text)' // Normal selected
      : isPreview
        ? 'bg-(--unselected-bg-preview) text-(--unselected-text-preview)' // Lighter grey for preview-deselect
        : 'bg-(--unselected-bg) text-(--unselected-text)' // Normal unselected
  }`;

  const isArchived = isArchiveSubfolder(subfolder);

  // Clicking or tabbing into the inline editor moves the keyboard nav origin
  // here, so navigation resumes from the row being edited
  const onEditorFocusCapture = useCallback(() => {
    if (!isCurrent) {
      dispatch(setCurrentAsset(assetId));
    }
  }, [isCurrent, assetId, dispatch]);

  // Clicking anywhere in the row inspects it, matching the grid's cells, so
  // the highlight follows the mouse as well as the keyboard
  const onRowClick = useCallback(
    (e: MouseEvent) => {
      // Pin the range origin before the highlight moves off it — only the
      // selection panel tracks hover, so a Shift+click out in the row body
      // may be the first thing to give the range an origin at all
      if (e.shiftKey) {
        dispatch(adoptCurrentAssetAsRangeAnchor());
      }
      if (!isCurrent) {
        dispatch(setCurrentAsset(assetId));
      }
      // With Shift held the highlight is the far end of a pending range, so
      // move the preview with it — the mouse equivalent of Shift+arrow
      if (e.shiftKey) {
        dispatch(setShiftHoverAssetId(assetId));
      }
    },
    [assetId, dispatch, isCurrent],
  );

  // Current-asset highlight: sky by default, shifting to the purple
  // selection language when the highlighted asset is itself selected
  const currentClasses = isCurrent
    ? `ring-2 ring-offset-2 ring-offset-(--background) ${showAsSelected ? 'ring-purple-500' : 'ring-sky-500'}`
    : '';

  return (
    <div
      data-asset-id={assetId}
      onClick={onRowClick}
      className={`my-2 flex w-full scroll-mt-36 scroll-mb-16 overflow-hidden rounded-lg border transition-shadow max-md:flex-col ${isSelected ? 'border-(--border-selected) shadow-sm shadow-purple-200 dark:shadow-purple-700' : 'border-(--border)'} ${isArchived ? 'opacity-60' : ''} ${currentClasses}`}
    >
      <div
        className={selectionPanelClasses}
        onClick={onToggleAssetSelection}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <Checkbox
          isSelected={isSelected}
          isSoftSelected={isCurrent}
          onChange={onToggleAssetSelection}
          ariaLabel={`Select asset ${assetId}`}
          previewState={previewState}
        />

        {isVideo ? (
          <span title="Videos don't use crop buckets">
            <EyeIcon className="h-4 w-4 self-center opacity-30" />
          </span>
        ) : wouldCrop ? (
          <Button
            size="xs"
            variant="ghost"
            color={isSelected ? 'indigo' : 'slate'}
            isPressed={showCropVisualization}
            onClick={onToggleLocalCropVisualization}
            title={`${showCropVisualization ? 'Hide' : 'Show'} crop visualisation for this asset`}
          >
            {showCropVisualization ? <EyeOffIcon /> : <EyeIcon />}
          </Button>
        ) : (
          <span title="Image shape and crop shape are identical">
            <EyeIcon className="h-4 w-4 self-center opacity-50" />
          </span>
        )}

        <span className="text-sm font-medium tabular-nums select-none text-shadow-(--surface-elevated) md:[writing-mode:sideways-lr]">
          {filteredIndex}
        </span>
      </div>

      <div className="flex w-full min-w-0 flex-wrap">
        <div
          className={`relative flex min-h-40 w-full cursor-pointer items-center justify-center self-stretch bg-(--surface-muted) transition-all ${!imageZoom ? 'md:w-1/4' : 'md:w-3/4'}`}
          onClick={toggleImageZoom}
        >
          <span
            className={`relative inline-flex ${!imageZoom ? 'max-h-64' : ''}`}
            style={{
              aspectRatio: getAspectRatio(
                dimensions.width,
                dimensions.height,
              ).join('/'),
            }}
          >
            {isVideo ? (
              <video
                className="h-full w-full object-contain"
                src={imageUrl}
                controls
                muted
                playsInline
                preload="metadata"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <Image
                  className="object-contain"
                  src={imageUrl}
                  width={dimensions.width}
                  height={dimensions.height}
                  alt=""
                  priority={filteredIndex <= 4}
                  placeholder={blurDataUrl ? 'blur' : 'empty'}
                  blurDataURL={blurDataUrl}
                />
                <CropVisualization
                  dimensions={dimensions}
                  bucket={bucket}
                  isVisible={showCropVisualization}
                />
              </>
            )}
          </span>
        </div>

        <div
          data-asset-editor
          onKeyDown={handleEditorEscape}
          onFocusCapture={onEditorFocusCapture}
          className={`min-h-40 w-full bg-slate-50 p-4 max-md:p-2 ${imageZoom ? 'md:w-1/4' : 'md:w-3/4'} dark:bg-slate-900`}
        >
          {captionMode === 'caption' ? (
            <CaptionManager assetId={assetId} />
          ) : captionMode === 'hybrid' ? (
            <HybridManager assetId={assetId} />
          ) : (
            <TaggingManager assetId={assetId} />
          )}
        </div>

        <AssetMetadata
          assetId={assetId}
          fileExtension={fileExtension}
          subfolder={subfolder}
          dimensions={dimensions}
          bucket={bucket}
          ioState={ioState}
          dimensionsComposed={dimensionsComposed}
        />
      </div>
    </div>
  );
};

// Custom comparison function for memo to avoid re-renders when object props have same values
const assetPropsAreEqual = (
  prevProps: AssetProps,
  nextProps: AssetProps,
): boolean => {
  // Check primitive props
  if (
    prevProps.assetId !== nextProps.assetId ||
    prevProps.fileExtension !== nextProps.fileExtension ||
    prevProps.subfolder !== nextProps.subfolder ||
    prevProps.filteredIndex !== nextProps.filteredIndex ||
    prevProps.ioState !== nextProps.ioState ||
    prevProps.lastModified !== nextProps.lastModified ||
    prevProps.blurDataUrl !== nextProps.blurDataUrl ||
    prevProps.currentPage !== nextProps.currentPage ||
    prevProps.previewState !== nextProps.previewState ||
    prevProps.onHover !== nextProps.onHover
  ) {
    return false;
  }

  // Check dimensions object
  if (
    prevProps.dimensions.width !== nextProps.dimensions.width ||
    prevProps.dimensions.height !== nextProps.dimensions.height
  ) {
    return false;
  }

  // Check bucket object
  if (
    prevProps.bucket.width !== nextProps.bucket.width ||
    prevProps.bucket.height !== nextProps.bucket.height ||
    prevProps.bucket.aspectRatio !== nextProps.bucket.aspectRatio
  ) {
    return false;
  }

  return true;
};

export const Asset = memo(AssetComponent, assetPropsAreEqual);
