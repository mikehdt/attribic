import { ArchiveIcon, FilmIcon } from 'lucide-react';
import Image from 'next/image';
import { memo, MouseEvent, useCallback } from 'react';

import { isSupportedVideoExtension } from '@/app/constants';
import { Checkbox } from '@/app/shared/checkbox';
import { ImageDimensions } from '@/app/store/assets';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import { selectProjectFolderName } from '@/app/store/project';
import {
  handleAssetClick,
  selectAssetIsCurrent,
  selectAssetIsSelected,
  setCurrentAsset,
} from '@/app/store/selection';
import { getImageUrl } from '@/app/utils/image-utils';
import { isArchiveSubfolder } from '@/app/utils/subfolder-utils';

type PreviewState = 'select' | 'deselect' | null;

// Cells render at ~12rem (192px); 384 covers 2x DPR without decoding the
// full-size original for every tile
const CELL_PREVIEW_PX = 384;

type GridCellProps = {
  assetId: string;
  fileExtension: string;
  subfolder?: string;
  filteredIndex: number;
  dimensions: ImageDimensions;
  lastModified: number;
  blurDataUrl?: string;
  currentPage: number;
  previewState?: PreviewState;
  onHover?: (assetId: string | null) => void;
  onActivate?: () => void;
};

const GridCellComponent = ({
  assetId,
  fileExtension,
  subfolder,
  filteredIndex,
  dimensions,
  lastModified,
  blurDataUrl,
  currentPage,
  previewState,
  onHover,
  onActivate,
}: GridCellProps) => {
  const dispatch = useAppDispatch();
  const isSelected = useAppSelector((state) =>
    selectAssetIsSelected(state, assetId),
  );
  const isCurrent = useAppSelector((state) =>
    selectAssetIsCurrent(state, assetId),
  );
  const projectName = useAppSelector(selectProjectFolderName);

  const isVideo = isSupportedVideoExtension(`.${fileExtension}`);
  const isArchived = isArchiveSubfolder(subfolder);

  const fileName = `${assetId}.${fileExtension}`;
  const baseUrl = getImageUrl(
    fileName,
    projectName || undefined,
    isVideo
      ? undefined
      : { maxWidth: CELL_PREVIEW_PX, maxHeight: CELL_PREVIEW_PX },
  );
  const imageUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}t=${lastModified}`;

  // Plain click inspects; shift-click is a selection gesture (range extend).
  // Selection and inspection stay separate: current = "what am I looking at",
  // selection = "what will batch operations apply to".
  //
  // Clicking the already-inspected cell toggles the tagging UI — the mouse
  // equivalent of Tab, then Escape. Deliberately not a dblclick listener: the
  // two clicks can be any distance apart, so a genuine double-click works but
  // so does looking first and editing later.
  const onCellClick = useCallback(
    (e: MouseEvent) => {
      if (e.shiftKey) {
        e.preventDefault(); // no text selection on shift-click
        dispatch(handleAssetClick({ assetId, isShiftHeld: true, currentPage }));
      } else if (isCurrent) {
        onActivate?.();
      } else {
        dispatch(setCurrentAsset(assetId));
      }
    },
    [assetId, currentPage, dispatch, isCurrent, onActivate],
  );

  const onToggleSelection = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      if (e.shiftKey) {
        e.preventDefault();
      }
      dispatch(
        handleAssetClick({ assetId, isShiftHeld: e.shiftKey, currentPage }),
      );
      // A mouse click leaves DOM focus on this checkbox, which would swallow
      // Enter/Space and re-fire on this cell no matter where the current-asset
      // highlight has moved. It's not tabbable (see below), so blurring can
      // never disrupt keyboard flow.
      (document.activeElement as HTMLElement | null)?.blur();
    },
    [assetId, currentPage, dispatch],
  );

  const handleMouseEnter = useCallback(() => {
    onHover?.(assetId);
  }, [onHover, assetId]);

  const handleMouseLeave = useCallback(() => {
    onHover?.(null);
  }, [onHover]);

  // Preview overrides actual selection for display, mirroring the list rows
  const showAsSelected =
    previewState === 'select'
      ? true
      : previewState === 'deselect'
        ? false
        : isSelected;
  const isPreview = previewState !== null && previewState !== undefined;

  // Opacity and border colour are transitioned on the cell below, so the
  // preview eases in and out rather than snapping as the range changes
  const borderClasses = showAsSelected
    ? isPreview
      ? 'border-(--border-selected) opacity-80'
      : 'border-(--border-selected) shadow-sm shadow-purple-200 dark:shadow-purple-700'
    : isPreview
      ? 'border-(--border) opacity-60'
      : 'border-(--border)';

  // Current-asset highlight: sky by default, shifting to the purple
  // selection language when the inspected cell is itself selected
  const currentClasses = isCurrent
    ? `ring-2 ring-offset-2 ring-offset-(--surface-muted) ${showAsSelected ? 'ring-purple-500' : 'ring-sky-500'}`
    : '';

  return (
    <div
      data-asset-id={assetId}
      // scroll-mb clears the fixed bottom shelf (h-12) with the same 1rem
      // breathing room the top margin allows past the shelf + sticky header
      className={`group relative aspect-square cursor-pointer scroll-mt-36 scroll-mb-16 overflow-hidden rounded-lg border bg-(--surface-muted) transition-[box-shadow,opacity,border-color] select-none ${borderClasses} ${currentClasses}`}
      onClick={onCellClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {isVideo ? (
        <video
          className={`pointer-events-none h-full w-full object-contain ${isArchived ? 'opacity-50' : ''}`}
          src={imageUrl}
          muted
          playsInline
          preload="metadata"
        />
      ) : (
        <Image
          className={`object-contain ${isArchived ? 'opacity-50' : ''}`}
          src={imageUrl}
          alt=""
          fill
          sizes="(min-width: 768px) 12rem, 33vw"
          placeholder={blurDataUrl ? 'blur' : 'empty'}
          blurDataURL={blurDataUrl}
        />
      )}

      <div
        className={`absolute top-1 left-1 z-10 flex rounded-md bg-white/80 p-1 transition-opacity dark:bg-slate-900/70 ${
          showAsSelected || isPreview
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        <Checkbox
          isSelected={isSelected}
          onChange={onToggleSelection}
          ariaLabel={`Select asset ${assetId}`}
          previewState={previewState}
          tabIndex={-1}
        />
      </div>

      {isVideo && (
        <span
          className="absolute top-1.5 right-1.5 rounded bg-black/50 p-0.5 text-white"
          title="Video"
        >
          <FilmIcon className="h-3.5 w-3.5" />
        </span>
      )}

      {isArchived && (
        <span
          className={`absolute top-1.5 rounded bg-black/50 p-0.5 text-white ${isVideo ? 'right-8' : 'right-1.5'}`}
          title="Archived"
        >
          <ArchiveIcon className="h-3.5 w-3.5" />
        </span>
      )}

      <span
        className="absolute bottom-1 left-1 rounded bg-black/50 px-1 text-xs font-medium text-white tabular-nums"
        title={`${dimensions.width} × ${dimensions.height}`}
      >
        {filteredIndex}
      </span>
    </div>
  );
};

// Custom comparison to avoid re-renders when object props hold the same values
const gridCellPropsAreEqual = (
  prevProps: GridCellProps,
  nextProps: GridCellProps,
): boolean =>
  prevProps.assetId === nextProps.assetId &&
  prevProps.fileExtension === nextProps.fileExtension &&
  prevProps.subfolder === nextProps.subfolder &&
  prevProps.filteredIndex === nextProps.filteredIndex &&
  prevProps.lastModified === nextProps.lastModified &&
  prevProps.blurDataUrl === nextProps.blurDataUrl &&
  prevProps.currentPage === nextProps.currentPage &&
  prevProps.previewState === nextProps.previewState &&
  prevProps.onHover === nextProps.onHover &&
  prevProps.onActivate === nextProps.onActivate &&
  prevProps.dimensions.width === nextProps.dimensions.width &&
  prevProps.dimensions.height === nextProps.dimensions.height;

export const GridCell = memo(GridCellComponent, gridCellPropsAreEqual);
