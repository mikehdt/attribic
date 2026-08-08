import { ImageIcon } from 'lucide-react';
import Image from 'next/image';

import { isSupportedVideoExtension } from '@/app/constants';
import { type ImageAsset,selectAssetById } from '@/app/store/assets';
import { useAppSelector } from '@/app/store/hooks';
import {
  selectCaptionMode,
  selectProjectFolderName,
  selectShowCropVisualization,
} from '@/app/store/project';
import { selectCurrentAssetId } from '@/app/store/selection';
import { AssetMetadata } from '@/app/tagging/components/asset/asset-metadata';
import { CropVisualization } from '@/app/tagging/components/asset/crop-visualization';
import { CaptionManager } from '@/app/tagging/components/tagging/caption-manager';
import { HybridManager } from '@/app/tagging/components/tagging/hybrid-manager';
import { TaggingManager } from '@/app/tagging/components/tagging/tagging-manager';
import { composeDimensions, getAspectRatio } from '@/app/utils/helpers';
import { getImageUrl } from '@/app/utils/image-utils';

// Preview letterbox height; the width calc below must use the same value so
// the contain box (and therefore the crop overlay) is sized exactly
const PREVIEW_HEIGHT_REM = 15;

/** Fixed-height letterbox so the tag editor always starts at the same y. */
const InspectorPreview = ({ asset }: { asset: ImageAsset }) => {
  const projectName = useAppSelector(selectProjectFolderName);
  const showCropVisualization = useAppSelector(selectShowCropVisualization);

  const isVideo = isSupportedVideoExtension(`.${asset.fileExtension}`);
  const fileName = `${asset.fileId}.${asset.fileExtension}`;
  const baseUrl = getImageUrl(fileName, projectName || undefined);
  const mediaUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}t=${asset.lastModified}`;

  const { width, height } = asset.dimensions;

  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden border-b border-(--border) bg-(--surface-muted)"
      style={{ height: `${PREVIEW_HEIGHT_REM}rem` }}
    >
      {isVideo ? (
        <video
          className="max-h-full max-w-full object-contain"
          src={mediaUrl}
          controls
          muted
          playsInline
          preload="metadata"
        />
      ) : (
        // The span is sized to the exact contain box: full letterbox height
        // unless the ratio-derived width would overflow, in which case width
        // caps at 100% and the aspect ratio pulls the height down. Sizing it
        // exactly is what keeps the crop overlay's percentages honest.
        <span
          className="relative block"
          style={{
            aspectRatio: getAspectRatio(width, height).join('/'),
            width: `min(100%, calc(${PREVIEW_HEIGHT_REM}rem * ${width / height}))`,
          }}
        >
          <Image
            className="object-contain"
            src={mediaUrl}
            alt=""
            fill
            sizes="22.5rem"
            placeholder={asset.blurDataUrl ? 'blur' : 'empty'}
            blurDataURL={asset.blurDataUrl}
          />
          <CropVisualization
            dimensions={asset.dimensions}
            bucket={asset.bucket}
            isVisible={showCropVisualization}
          />
        </span>
      )}
    </div>
  );
};

const InspectorContent = ({ asset }: { asset: ImageAsset }) => {
  const captionMode = useAppSelector(selectCaptionMode);

  return (
    <>
      <InspectorPreview asset={asset} />

      {/* text-sm cascades into the tag chips, add-tag input and caption
          editor (they all inherit font size), keeping the narrow column
          comfortable without threading a size prop through the components */}
      <div className="p-4 text-sm">
        {captionMode === 'caption' ? (
          <CaptionManager assetId={asset.fileId} />
        ) : captionMode === 'hybrid' ? (
          <HybridManager assetId={asset.fileId} />
        ) : (
          <TaggingManager assetId={asset.fileId} />
        )}
      </div>

      {/* Meta stays below the tags (matching the list view's footer strip) and
          pins to the panel bottom, so both sections hold a consistent position
          from image to image */}
      <div className="mt-auto">
        <AssetMetadata
          assetId={asset.fileId}
          fileExtension={asset.fileExtension}
          subfolder={asset.subfolder}
          dimensions={asset.dimensions}
          bucket={asset.bucket}
          ioState={asset.ioState}
          dimensionsComposed={composeDimensions(asset.dimensions)}
        />
      </div>
    </>
  );
};

/**
 * The inspector column for the grid view. The outer div is an in-flow spacer
 * that reserves the column's width; the inner panel is fixed so it can never
 * scroll off between the shelves — with no left/right offsets a fixed element
 * keeps its static horizontal position, so it stays aligned with the spacer
 * at every viewport width. Content taller than the gap scrolls internally.
 *
 * Layout: fixed-height image preview, then the mode-aware tag editor, then
 * the metadata strip pinned to the bottom.
 */
export const GridSidebar = () => {
  const currentAssetId = useAppSelector(selectCurrentAssetId);
  const asset = useAppSelector((state) =>
    currentAssetId ? selectAssetById(state, currentAssetId) : undefined,
  );

  return (
    <div className="w-90 shrink-0 max-lg:hidden">
      <div className="fixed top-24 bottom-14 flex w-90 flex-col overflow-y-auto rounded-lg border border-(--border) bg-slate-50 dark:bg-slate-900">
        {asset ? (
          <InspectorContent asset={asset} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center text-slate-400 dark:text-slate-500">
            <ImageIcon className="h-10 w-10" />
            <p className="text-sm">
              Click an image to inspect it, or use the arrow keys to navigate.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
