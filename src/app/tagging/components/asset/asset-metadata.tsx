import {
  ArchiveIcon,
  BookmarkCheckIcon,
  BookmarkXIcon,
  FolderOpenIcon,
  ImageIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { memo, useCallback } from 'react';

import { isSupportedVideoExtension } from '@/app/constants';
import { Button } from '@/app/shared/button';
import { useToast } from '@/app/shared/toast';
import type { RootState } from '@/app/store';
import {
  IoState,
  KohyaBucket,
  resetTags,
  saveAsset,
  selectAssetHasModifiedTags,
  selectIsBatchSaveInProgress,
} from '@/app/store/assets';
import {
  toggleBucketFilter,
  toggleExtensionFilter,
  toggleSizeFilter,
  toggleSubfolderFilter,
} from '@/app/store/filters';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import { selectProjectFolderName } from '@/app/store/project';
import { highlightPatterns } from '@/app/tagging/utils/text-highlight';
import { parseSubfolder } from '@/app/utils/subfolder-utils';

// Individual selectors for metadata - avoids creating new object references
const selectFilenamePatterns = (state: RootState) =>
  state.filters.filenamePatterns;
const selectFilterSizes = (state: RootState) => state.filters.filterSizes;
const selectFilterBuckets = (state: RootState) => state.filters.filterBuckets;
const selectFilterExtensions = (state: RootState) =>
  state.filters.filterExtensions;
const selectFilterSubfolders = (state: RootState) =>
  state.filters.filterSubfolders;

type AssetMetadataProps = {
  assetId: string;
  fileExtension: string;
  subfolder?: string;
  dimensions: { width: number; height: number };
  bucket: KohyaBucket;
  ioState: IoState;
  dimensionsComposed: string;
};

const AssetMetadataComponent = ({
  assetId,
  fileExtension,
  subfolder,
  dimensions,
  bucket,
  ioState,
  dimensionsComposed,
}: AssetMetadataProps) => {
  const dispatch = useAppDispatch();

  // Parse subfolder to display repeat count and label
  const parsed = subfolder ? parseSubfolder(subfolder) : null;
  const subfolderDisplay = parsed
    ? `${parsed.repeatCount}× ${parsed.label}`
    : null;

  // Extract filename without subfolder path for display
  const slashIndex = subfolder ? assetId.indexOf('/') : -1;
  const displayFilename =
    slashIndex !== -1 ? assetId.substring(slashIndex + 1) : assetId;

  // Individual selector calls - each only triggers re-render when its specific value changes
  const filenamePatterns = useAppSelector(selectFilenamePatterns);
  const filterSizes = useAppSelector(selectFilterSizes);
  const filterBuckets = useAppSelector(selectFilterBuckets);
  const filterExtensions = useAppSelector(selectFilterExtensions);
  const filterSubfolders = useAppSelector(selectFilterSubfolders);
  const isBatchSaveInProgress = useAppSelector(selectIsBatchSaveInProgress);
  const projectFolderName = useAppSelector(selectProjectFolderName);

  // Use optimised selector - only re-renders when THIS asset's modified state changes
  const hasModifiedTags =
    useAppSelector((state) => selectAssetHasModifiedTags(state, assetId)) &&
    ioState !== IoState.SAVING;

  const { showToast } = useToast();

  const isVideo = isSupportedVideoExtension(`.${fileExtension}`);

  // Calculate pressed states based on filter arrays
  const dimensionsActive = filterSizes.includes(dimensionsComposed);
  const bucketComposed = `${bucket.width}×${bucket.height}`;
  const bucketActive = filterBuckets.includes(bucketComposed);
  const extensionActive = filterExtensions.includes(fileExtension);
  const subfolderActive = subfolder
    ? filterSubfolders.includes(subfolder)
    : false;

  // Disable buttons when the individual asset is saving or a batch save is in progress
  const isSaving = ioState === IoState.SAVING || isBatchSaveInProgress;

  const saveFailed = ioState === IoState.ERROR;

  const handleToggleSize = useCallback(
    () => dispatch(toggleSizeFilter(dimensionsComposed)),
    [dispatch, dimensionsComposed],
  );

  const handleToggleBucket = useCallback(
    () => dispatch(toggleBucketFilter(bucketComposed)),
    [dispatch, bucketComposed],
  );

  const handleToggleExtension = useCallback(
    () => dispatch(toggleExtensionFilter(fileExtension)),
    [dispatch, fileExtension],
  );

  const handleToggleSubfolder = useCallback(() => {
    if (subfolder) {
      dispatch(toggleSubfolderFilter(subfolder));
    }
  }, [dispatch, subfolder]);

  const handleCopyAssetPath = useCallback(async () => {
    // Copy just the filename without subfolder path
    const fullPath = `${displayFilename}.${fileExtension}`;

    try {
      await navigator.clipboard.writeText(fullPath);
      showToast('Filename copied to clipboard');
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      showToast('Failed to copy file path');
    }
  }, [displayFilename, fileExtension, showToast]);

  const handleCancelAction = useCallback(() => {
    if (isSaving) {
      return;
    }
    dispatch(resetTags(assetId));
  }, [dispatch, assetId, isSaving]);

  const handleSaveAction = useCallback(() => {
    if (isSaving) {
      return;
    }
    dispatch(
      saveAsset({
        fileId: assetId,
        projectPath: projectFolderName || undefined,
      }),
    );
  }, [dispatch, assetId, isSaving, projectFolderName]);

  return (
    <div
      className={`flex w-full items-end gap-2 border-t px-2 py-1 text-sm inset-shadow-sm transition-colors ${
        saveFailed
          ? 'border-t-rose-300 bg-rose-100 inset-shadow-white dark:border-t-rose-600 dark:bg-rose-900 dark:inset-shadow-rose-700'
          : hasModifiedTags
            ? 'border-t-amber-300 bg-amber-100 inset-shadow-white dark:border-t-amber-600 dark:bg-amber-900 dark:inset-shadow-amber-700'
            : 'border-t-(--border) bg-(--surface) inset-shadow-white dark:inset-shadow-slate-700'
      }`}
    >
      <span className="inline-flex min-w-0 flex-1 flex-wrap items-center gap-2 py-0.5 tabular-nums">
        <Button
          type="button"
          color="sky"
          size="xs"
          width="md"
          isPressed={dimensionsActive}
          onClick={handleToggleSize}
          title="Image dimensions"
        >
          <ImageIcon />
          {dimensions.width}&times;{dimensions.height}
        </Button>

        {!isVideo && (
          <Button
            type="button"
            color="slate"
            size="xs"
            width="md"
            isPressed={bucketActive}
            onClick={handleToggleBucket}
            title="Bucket dimensions"
          >
            <ArchiveIcon />
            {bucket.width}&times;{bucket.height}
          </Button>
        )}

        <Button
          type="button"
          color="stone"
          size="xs"
          width="md"
          isPressed={extensionActive}
          onClick={handleToggleExtension}
        >
          {fileExtension}
        </Button>

        {subfolderDisplay && (
          <Button
            type="button"
            color="indigo"
            size="xs"
            width="md"
            isPressed={subfolderActive}
            onClick={handleToggleSubfolder}
            title={`Repeat folder: ${subfolder}`}
          >
            <FolderOpenIcon />
            {subfolderDisplay}
          </Button>
        )}

        <span
          className="ml-2 cursor-pointer self-center truncate text-(--unselected-text) transition-colors hover:text-(--foreground) max-sm:order-1 max-sm:w-full max-sm:pt-2"
          style={{ textShadow: 'var(--surface-elevated) 0 1px 0' }}
          onClick={handleCopyAssetPath}
          title="Click to copy the full filename"
        >
          {highlightPatterns(displayFilename, filenamePatterns)}
        </span>
      </span>

      {saveFailed ? (
        <span
          className="flex shrink-0 items-center gap-1 self-center pl-2 text-rose-700 dark:text-rose-300"
          title="The tag file could not be written — check the file isn't locked, then save again"
        >
          <TriangleAlertIcon className="h-4 w-4" />
          Save failed
        </span>
      ) : null}

      {hasModifiedTags ? (
        <span className="-my-0.5 flex shrink-0 gap-2 pl-2">
          <Button
            color="stone"
            size="sm"
            width="lg"
            onClick={handleCancelAction}
            disabled={isSaving}
          >
            <BookmarkXIcon />
            Cancel
          </Button>

          <Button
            color="teal"
            size="sm"
            width="lg"
            onClick={handleSaveAction}
            disabled={isSaving}
          >
            <BookmarkCheckIcon />
            Save
          </Button>
        </span>
      ) : null}
    </div>
  );
};

export const AssetMetadata = memo(AssetMetadataComponent);
