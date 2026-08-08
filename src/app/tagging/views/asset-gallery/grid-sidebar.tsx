import { ImageIcon, XIcon } from 'lucide-react';
import Image from 'next/image';
import { KeyboardEvent } from 'react';

import { isSupportedVideoExtension } from '@/app/constants';
import { type ImageAsset, selectAssetById } from '@/app/store/assets';
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

import { useScrollFade } from './use-scroll-fade';

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
 * Overlay hinting that the panel continues past this edge. It matches the
 * panel's own background so the content appears to dissolve into it, and it
 * eases out once that edge is reached.
 */
const ScrollFade = ({
  edge,
  isVisible,
}: {
  edge: 'top' | 'bottom';
  isVisible: boolean;
}) => (
  <div
    aria-hidden
    className={`pointer-events-none absolute inset-x-0 h-8 from-slate-200 to-transparent transition-opacity duration-200 dark:from-slate-900 ${
      edge === 'top' ? 'top-0 bg-linear-to-b' : 'bottom-0 bg-linear-to-t'
    } ${isVisible ? 'opacity-100' : 'opacity-0'}`}
  />
);

/**
 * Escape hands keyboard control back to the grid: blurring the focused widget
 * makes the grid's window-level nav active again (it only needs focus to be
 * outside the inspector). Widgets with an Escape meaning of their own win
 * first — the autocomplete preventDefaults its dismiss, the caption editor
 * blurs itself, and a text field keeps Escape while it still has content to
 * clear — so backing out is repeated Escapes, never a lost edit.
 */
const handleEscapeToGrid = (e: KeyboardEvent<HTMLDivElement>) => {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  const target = e.target as HTMLElement;
  if (
    (target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement) &&
    target.value
  ) {
    return;
  }
  target.blur();
  e.preventDefault();
};

type GridSidebarProps = {
  isOverlayOpen: boolean;
  onOverlayClose: () => void;
};

/**
 * The inspector column for the grid view. The outer div is an in-flow spacer
 * that reserves the column's width; the inner panel is fixed so it can never
 * scroll off between the shelves — with no left/right offsets a fixed element
 * keeps its static horizontal position, so it stays aligned with the spacer
 * at every viewport width. Content taller than the gap scrolls internally.
 *
 * Below lg the column disappears; Tab summons the same panel as a floating
 * overlay instead (opened by the grid keyboard nav). It stays non-modal — no
 * dialog role, no scrim — so arrow keys keep driving the grid underneath and
 * the panel live-updates, same as the desktop flow. The spacer collapses to
 * zero width (absolute + w-0) rather than hiding, since display:none would
 * take the fixed panel down with it; the panel re-anchors to the viewport's
 * right edge, which overrides the static-position trick at those widths.
 *
 * Layout: fixed-height image preview, then the mode-aware tag editor, then
 * the metadata strip pinned to the bottom.
 */
export const GridSidebar = ({
  isOverlayOpen,
  onOverlayClose,
}: GridSidebarProps) => {
  const currentAssetId = useAppSelector(selectCurrentAssetId);
  const asset = useAppSelector((state) =>
    currentAssetId ? selectAssetById(state, currentAssetId) : undefined,
  );
  const { scrollRef, contentRef, hasScrollAbove, hasScrollBelow } =
    useScrollFade();

  return (
    <div
      className={`w-90 shrink-0 ${isOverlayOpen ? 'max-lg:absolute max-lg:w-0' : 'max-lg:hidden'}`}
    >
      <div
        data-grid-inspector
        onKeyDown={handleEscapeToGrid}
        className="fixed top-24 bottom-14 flex w-90 flex-col overflow-hidden rounded-lg border border-(--border) bg-slate-50 max-lg:right-4 max-lg:z-30 max-lg:max-w-[calc(100vw-2rem)] max-lg:shadow-xl dark:bg-slate-900"
      >
        <button
          data-inspector-close
          className="absolute top-2 right-2 z-10 rounded-md bg-white/80 p-1 text-slate-500 transition-colors hover:text-slate-700 lg:hidden dark:bg-slate-900/70 dark:text-slate-400 dark:hover:text-slate-200"
          onClick={onOverlayClose}
          title="Close inspector"
          aria-label="Close inspector"
        >
          <XIcon className="h-4 w-4" />
        </button>

        <div
          ref={scrollRef}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto"
        >
          {/* Single wrapper so the fade hook has one element to measure the
              content against, and so the metadata's mt-auto still resolves
              against the full panel height when the content is short */}
          <div ref={contentRef} className="flex flex-1 flex-col">
            {asset ? (
              <InspectorContent asset={asset} />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center text-slate-400 dark:text-slate-500">
                <ImageIcon className="h-10 w-10" />
                <p className="text-sm">
                  Click an image to inspect it, or use the arrow keys to
                  navigate. Tab jumps into this panel; Escape returns to the
                  grid.
                </p>
              </div>
            )}
          </div>
        </div>

        <ScrollFade edge="top" isVisible={hasScrollAbove} />
        <ScrollFade edge="bottom" isVisible={hasScrollBelow} />
      </div>
    </div>
  );
};
