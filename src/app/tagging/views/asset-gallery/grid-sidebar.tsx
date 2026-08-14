import {
  ChevronsLeftIcon,
  ChevronsRightIcon,
  ImageIcon,
  XIcon,
} from 'lucide-react';
import Image from 'next/image';
import { CSSProperties, RefObject, useEffect, useRef, useState } from 'react';

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

import { handleEditorEscape } from './editor-focus';
import { useScrollFade } from './use-scroll-fade';
import { useZoomKey } from './use-zoom-key';

// Preview letterbox heights (collapsed/expanded); the width calc below must
// use the active value so the contain box (and therefore the crop overlay)
// is sized exactly
const PREVIEW_HEIGHT_REM = 15;
const PREVIEW_HEIGHT_EXPANDED_REM = 26;

// Served-image caps: the expanded letterbox is 26rem tall in a 45rem panel,
// so 1440×832 covers 2x DPR for both orientations. One URL for collapsed and
// expanded, so toggling zoom never refetches.
const PREVIEW_CONSTRAINTS = {
  maxWidth: 1440,
  maxHeight: PREVIEW_HEIGHT_EXPANDED_REM * 16 * 2,
};

/** Fixed-height letterbox so the tag editor always starts at the same y. */
const InspectorPreview = ({
  asset,
  isExpanded,
  onToggleExpand,
}: {
  asset: ImageAsset;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) => {
  const projectName = useAppSelector(selectProjectFolderName);
  const showCropVisualization = useAppSelector(selectShowCropVisualization);

  const isVideo = isSupportedVideoExtension(`.${asset.fileExtension}`);
  const fileName = `${asset.fileId}.${asset.fileExtension}`;
  const baseUrl = getImageUrl(
    fileName,
    projectName || undefined,
    isVideo ? undefined : PREVIEW_CONSTRAINTS,
  );
  const mediaUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}t=${asset.lastModified}`;

  const { width, height } = asset.dimensions;
  const heightRem = isExpanded
    ? PREVIEW_HEIGHT_EXPANDED_REM
    : PREVIEW_HEIGHT_REM;

  return (
    <div
      className="flex shrink-0 cursor-pointer items-center justify-center overflow-hidden border-b border-(--border) bg-(--surface-muted) transition-[height] duration-300 ease-in-out"
      style={{ height: `${heightRem}rem` }}
      onClick={onToggleExpand}
    >
      {isVideo ? (
        <video
          className="max-h-full max-w-full object-contain"
          src={mediaUrl}
          controls
          muted
          playsInline
          preload="metadata"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        // The span is sized to the exact contain box: full letterbox height
        // unless the ratio-derived width would overflow, in which case width
        // caps at 100% and the aspect ratio pulls the height down. Sizing it
        // exactly is what keeps the crop overlay's percentages honest.
        <span
          className="relative block transition-[width] duration-300 ease-in-out"
          style={{
            aspectRatio: getAspectRatio(width, height).join('/'),
            width: `min(100%, calc(${heightRem}rem * ${width / height}))`,
          }}
        >
          <Image
            className="object-contain"
            src={mediaUrl}
            alt=""
            fill
            sizes={isExpanded ? '45rem' : '22.5rem'}
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

const InspectorContent = ({
  asset,
  isExpanded,
  onToggleExpand,
}: {
  asset: ImageAsset;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) => {
  const captionMode = useAppSelector(selectCaptionMode);

  return (
    <>
      <InspectorPreview
        asset={asset}
        isExpanded={isExpanded}
        onToggleExpand={onToggleExpand}
      />

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

type GridSidebarProps = {
  isOverlayOpen: boolean;
  onOverlayClose: () => void;
};

/**
 * Measures where the spacer's right edge lands so the panel can be anchored
 * with a real `right` offset (at lg+) instead of relying on its static
 * position. Anchoring right means the expand animation transitions width
 * alone and the right edge is pinned by geometry — animating width plus a
 * compensating translate-x is equivalent on paper, but width is a layout
 * property and transform is composited, and the two pipelines don't tick in
 * lockstep, so the right edge visibly wobbles mid-animation. Observing the
 * body catches window resizes and scrollbar appearance alike; measuring
 * against documentElement.clientWidth keeps the offset scrollbar-safe.
 * Before the first measurement (SSR included) the declaration is invalid and
 * falls back to the static-position alignment, which is the same position.
 */
const usePinnedRightEdge = (spacerRef: RefObject<HTMLDivElement | null>) => {
  const [rightPx, setRightPx] = useState<number | null>(null);

  useEffect(() => {
    const measure = () => {
      if (!spacerRef.current) return;
      const { right } = spacerRef.current.getBoundingClientRect();
      setRightPx(document.documentElement.clientWidth - right);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    return () => observer.disconnect();
  }, [spacerRef]);

  return rightPx;
};

/**
 * The inspector column for the grid view. The outer div is an in-flow spacer
 * that reserves the column's width; the inner panel is fixed so it can never
 * scroll off between the shelves — with no left/right offsets a fixed element
 * keeps its static horizontal position, so it stays aligned with the spacer
 * at every viewport width. Content taller than the gap scrolls internally.
 *
 * Below lg the column disappears; Tab (or a second click on the inspected
 * cell) summons the same panel as a floating overlay instead. It stays
 * non-modal — no
 * dialog role, no scrim — so arrow keys keep driving the grid underneath and
 * the panel live-updates, same as the desktop flow. The spacer collapses to
 * zero width (absolute + w-0) rather than hiding, since display:none would
 * take the fixed panel down with it; the panel re-anchors to the viewport's
 * right edge, which overrides the static-position trick at those widths.
 *
 * Layout: fixed-height image preview, then the mode-aware tag editor, then
 * the metadata strip pinned to the bottom.
 *
 * Expanding pops the panel out over the grid without moving it: the spacer
 * keeps its width (so the grid never reflows) while the right-anchored panel
 * (see usePinnedRightEdge) widens leftward over the grid — width is the only
 * transitioned box property, so the right edge cannot move. Expansion is
 * transient — inspecting a different asset collapses it, and returning to a
 * previously expanded asset does not re-expand.
 */
export const GridSidebar = ({
  isOverlayOpen,
  onOverlayClose,
}: GridSidebarProps) => {
  const currentAssetId = useAppSelector(selectCurrentAssetId);
  const asset = useAppSelector((state) =>
    currentAssetId ? selectAssetById(state, currentAssetId) : undefined,
  );
  const [isExpanded, setIsExpanded] = useState(false);
  // Expansion is transient, not a property of the asset: inspecting a
  // different asset collapses it, and coming back doesn't re-expand.
  // State-reset-during-render instead of an effect, so the collapse renders
  // in the same pass as the new asset.
  const [lastAssetId, setLastAssetId] = useState(currentAssetId);
  if (currentAssetId !== lastAssetId) {
    setLastAssetId(currentAssetId);
    setIsExpanded(false);
  }
  // z expands/collapses the inspected image, mirroring a click on the preview
  useZoomKey(!!asset, () => setIsExpanded((prev) => !prev));

  const spacerRef = useRef<HTMLDivElement>(null);
  const pinnedRightPx = usePinnedRightEdge(spacerRef);
  const { scrollRef, contentRef, hasScrollAbove, hasScrollBelow } =
    useScrollFade();

  return (
    <div
      ref={spacerRef}
      className={`w-90 shrink-0 ${isOverlayOpen ? 'max-lg:absolute max-lg:w-0' : 'max-lg:hidden'}`}
    >
      <div
        data-grid-inspector
        onKeyDown={handleEditorEscape}
        style={
          pinnedRightPx !== null
            ? ({ '--inspector-right': `${pinnedRightPx}px` } as CSSProperties)
            : undefined
        }
        className={`fixed top-24 bottom-14 z-20 flex flex-col overflow-hidden rounded-lg border border-(--border) bg-slate-50 transition-[width,box-shadow] duration-300 ease-in-out max-lg:right-4 max-lg:z-30 max-lg:max-w-[calc(100vw-2rem)] max-lg:shadow-xl lg:right-(--inspector-right) dark:bg-slate-900 ${
          isExpanded ? 'w-180 shadow-xl' : 'w-90'
        }`}
      >
        <button
          data-inspector-close
          className="absolute top-3 right-3 z-1 cursor-pointer rounded-full border border-slate-300/0 bg-white p-1 text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none lg:hidden dark:border-slate-600/0 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          onClick={onOverlayClose}
          title="Close inspector"
          aria-label="Close inspector"
        >
          <XIcon className="h-4 w-4" />
        </button>

        {asset && (
          <button
            className="absolute top-3 left-3 z-1 cursor-pointer rounded-full border border-slate-300/0 bg-white p-1 text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none dark:border-slate-600/0 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? 'Collapse inspector' : 'Expand inspector'}
            aria-label={isExpanded ? 'Collapse inspector' : 'Expand inspector'}
            aria-expanded={isExpanded}
          >
            {isExpanded ? (
              <ChevronsRightIcon className="h-4 w-4" />
            ) : (
              <ChevronsLeftIcon className="h-4 w-4" />
            )}
          </button>
        )}

        <div
          ref={scrollRef}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto"
        >
          {/* Single wrapper so the fade hook has one element to measure the
              content against, and so the metadata's mt-auto still resolves
              against the full panel height when the content is short */}
          <div ref={contentRef} className="flex flex-1 flex-col">
            {asset ? (
              <InspectorContent
                asset={asset}
                isExpanded={isExpanded}
                onToggleExpand={() => setIsExpanded(!isExpanded)}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center text-slate-400 dark:text-slate-500">
                <ImageIcon className="h-10 w-10" />
                <p className="text-sm">
                  Click an image to inspect it, or use the arrow keys to
                  navigate. Clicking it again — or pressing Tab — jumps into
                  this panel; Escape returns to the grid.
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
