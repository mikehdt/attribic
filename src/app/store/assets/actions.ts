// Async thunk actions
import { createAction, createAsyncThunk } from '@reduxjs/toolkit';

// Action to handle delayed completion transition (250ms delay to show 100% progress)
export const completeAfterDelay = createAsyncThunk<void, void>(
  'assets/completeAfterDelay',
  async () => {
    return new Promise<void>((resolve) => {
      // Use requestAnimationFrame to ensure we wait for the next frame first
      requestAnimationFrame(() => {
        setTimeout(() => {
          resolve();
        }, 350);
      });
    });
  },
);

import { isSupportedVideoExtension } from '@/app/constants';
// Import removed since DEFAULT_BATCH_SIZE is now used through helpers
import {
  AssetTagOperation,
  BlurCache,
  getImageAssetDetails,
  getImageFileList,
  getMultipleImageAssetDetails,
  ImageFileListResult,
  type MoveAssetOperation,
  type MoveAssetsResult,
  moveAssetsToFolder,
  saveAssetTags,
  saveMultipleAssetTags,
} from '@/app/utils/asset-actions';
import { ARCHIVE_FOLDER } from '@/app/utils/subfolder-utils';

import type { ProjectState } from '../project/types';
import { addToast } from '../toasts';
import {
  composeAssetText,
  createCleanTagStatus,
  createSaveAssetResult,
  findModifiedAssets,
  getUpdatedTags,
  processBatchesWithProgress,
  processSaveResults,
} from './helpers';
import {
  ImageAsset,
  ImageAssets,
  LoadProgress,
  SaveAssetResult,
  SaveProgress,
} from './types';

export const updateSaveProgress = createAction<SaveProgress>(
  'assets/updateSaveProgress',
);

export const clearSaveErrors = createAction('assets/clearSaveErrors');

export const updateLoadProgress = createAction<LoadProgress>(
  'assets/updateLoadProgress',
);

export const clearLoadErrors = createAction('assets/clearLoadErrors');

export const loadAllAssets = createAsyncThunk<
  ImageAsset[],
  { maintainIoState?: boolean; projectPath?: string } | undefined,
  { state: { assets: ImageAssets; project: ProjectState } }
>('assets/loadAllAssets', async (options, { dispatch, getState }) => {
  try {
    // Build blur cache from existing assets to reuse unchanged blur data
    const {
      assets: { images },
    } = getState();
    const blurCache: BlurCache = {};
    for (const asset of images) {
      const isVideo = isSupportedVideoExtension(`.${asset.fileExtension}`);
      if (asset.blurDataUrl || isVideo) {
        blurCache[asset.fileId] = {
          lastModified: asset.lastModified,
          blurDataUrl: asset.blurDataUrl,
          videoDimensions: isVideo ? asset.dimensions : undefined,
        };
      }
    }

    // First, get the list of image files (fast operation)
    const result: ImageFileListResult = await getImageFileList(
      options?.projectPath,
    );

    // Handle directory read errors
    if (result.error) {
      dispatch(addToast({ children: result.error, variant: 'error' }));

      // For custom projects (projectPath provided) with folder not found,
      // reject so AppProvider redirects to project list
      if (options?.projectPath && result.errorType === 'not_found') {
        throw new Error(result.error);
      }

      // For default project or other errors, return empty array gracefully
      return [];
    }

    const imageFiles = result.files;

    // Initialize progress tracking when we know the total and clear any previous errors
    const totalFiles = imageFiles.length;
    if (totalFiles === 0) return [];

    dispatch(clearLoadErrors());

    // Define the update progress function that includes error tracking
    // Track failed loads
    let failedCount = 0;
    const failedFiles: string[] = [];

    // Define the update progress function that includes error tracking
    const updateProgress = (completed: number, total: number) => {
      dispatch(
        updateLoadProgress({
          completed,
          total,
          failed: failedCount,
          errors: failedFiles.length > 0 ? failedFiles : undefined,
        }),
      );
    };

    // Process batches using the helper
    const imageAssets = await processBatchesWithProgress<
      string,
      ImageAsset,
      ImageAsset
    >(
      imageFiles,
      // Process a batch of files
      async (batch) => {
        const { assets, errors } = await getMultipleImageAssetDetails(
          batch,
          options?.projectPath,
          blurCache,
        );
        // Update error count and track failed files for this batch
        if (errors.length > 0) {
          failedCount += errors.length;
          failedFiles.push(...errors);
        }
        return assets;
      },
      // Update progress
      updateProgress,
      // Total items for progress tracking
      totalFiles,
      // Fallback for individual processing
      async (file) => {
        try {
          return await getImageAssetDetails(
            file,
            options?.projectPath,
            blurCache,
          );
        } catch (error) {
          console.error(`Failed to process file ${file}:`, error);
          failedCount++;
          failedFiles.push(file);
          return null;
        }
      },
    );

    return imageAssets;
  } catch (error) {
    // Provide better error messages to the user
    console.error('Error loading assets:', error);
    throw new Error(
      error instanceof Error ? error.message : 'Failed to load assets',
    );
  }
});

export const saveAsset = createAsyncThunk<
  SaveAssetResult,
  { fileId: string; projectPath?: string },
  { state: { assets: ImageAssets; project: ProjectState } }
>('assets/saveAsset', async ({ fileId, projectPath }, { getState }) => {
  const {
    assets: { images, imageIndexById },
    project,
  } = getState();
  const captionMode = project.config.captionMode;

  const assetIndex = imageIndexById[fileId];
  if (assetIndex === undefined) {
    throw new Error(`Asset with ID ${fileId} not found`);
  }

  const asset = images[assetIndex];

  // Caption mode: write raw caption text directly
  if (captionMode === 'caption') {
    const success = await saveAssetTags(fileId, asset.captionText, projectPath);
    if (success) {
      return {
        assetIndex,
        fileId,
        tagList: asset.tagList,
        tagStatus: asset.tagStatus,
        savedTagList: asset.savedTagList,
        captionText: asset.captionText,
        savedCaptionText: asset.captionText,
      };
    }
    throw new Error(`Unable to save caption for ${fileId}`);
  }

  // Tag / hybrid mode: compose the on-disk string for this mode.
  const updateTags = getUpdatedTags(asset);
  const composedText = composeAssetText(asset, captionMode);

  const success = await saveAssetTags(fileId, composedText, projectPath);

  if (success) {
    const newTagStatus = createCleanTagStatus(updateTags);

    if (captionMode === 'hybrid') {
      // Hybrid persists both tags and caption — snapshot both as saved.
      return {
        assetIndex,
        fileId,
        tagList: updateTags,
        tagStatus: newTagStatus,
        savedTagList: [...updateTags],
        captionText: asset.captionText,
        savedCaptionText: asset.captionText,
      };
    }

    return createSaveAssetResult(
      asset,
      updateTags,
      newTagStatus,
      imageIndexById,
    );
  }

  throw new Error(`Unable to save the asset ${fileId}`);
});

// Save all assets with modified tags
export const saveAllAssets = createAsyncThunk<
  { savedCount: number; errorCount?: number; results?: Array<SaveAssetResult> },
  { projectPath?: string } | undefined,
  { state: { assets: ImageAssets; project: ProjectState } }
>('assets/saveAllAssets', async (options, { getState, dispatch }) => {
  const {
    assets: { images, imageIndexById },
    project,
  } = getState();
  const captionMode = project.config.captionMode;

  // Find all images with modifications
  const modifiedAssets = findModifiedAssets(images, captionMode);

  if (modifiedAssets.length === 0) {
    return { savedCount: 0 };
  }

  // Initialize progress tracking and clear any previous errors
  const totalAssets = modifiedAssets.length;
  dispatch(clearSaveErrors());
  dispatch(updateSaveProgress({ total: totalAssets, completed: 0, failed: 0 }));

  // Prepare batch operations for disk writes using helper functions
  const writeOperations: AssetTagOperation[] = modifiedAssets.map((asset) => ({
    fileId: asset.fileId,
    composedTags: composeAssetText(asset, captionMode),
  }));

  // Track success and error counts
  let successCount = 0;
  let errorCount = 0;
  const failedFiles: string[] = [];

  // Define the update progress function directly in this function
  const updateProgress = (completed: number, total: number, failed = 0) => {
    dispatch(
      updateSaveProgress({
        completed,
        total,
        failed,
        errors: failedFiles.length > 0 ? failedFiles : undefined,
      }),
    );
  };

  try {
    // Process batches using the helper
    const writeResults = await processBatchesWithProgress<
      AssetTagOperation,
      { fileId: string; success: boolean }
    >(
      writeOperations,
      // Process a batch of operations
      async (batch) => {
        const { results, errors } = await saveMultipleAssetTags(
          batch,
          options?.projectPath,
        );
        // Add any errors to our tracking
        if (errors.length > 0) {
          failedFiles.push(...errors);
        }
        return results;
      },
      // Update progress
      (completed, total, failed = 0) => {
        updateProgress(completed, total, failed);
      },
      // Total items for progress tracking
      totalAssets,
      // Fallback for individual processing
      async (operation) => {
        const success = await saveAssetTags(
          operation.fileId,
          operation.composedTags,
          options?.projectPath,
        );
        if (!success) {
          failedFiles.push(operation.fileId);
        }
        return { fileId: operation.fileId, success };
      },
    );

    // Process the results to create SaveAssetResult objects
    const processedResults = processSaveResults(
      writeResults,
      modifiedAssets,
      imageIndexById,
      captionMode,
    );

    successCount = processedResults.successCount;
    errorCount = processedResults.errorCount;

    return {
      savedCount: successCount,
      errorCount: errorCount,
      results: processedResults.results,
    };
  } catch (error) {
    console.error('Error saving assets:', error);
    throw new Error(
      error instanceof Error ? error.message : 'Failed to save assets',
    );
  }
});

// Move assets to a different folder (or root)
export const moveAssetsToFolderThunk = createAsyncThunk<
  MoveAssetsResult,
  { assetIds: string[]; destination: string | null; projectPath?: string }
>(
  'assets/moveAssetsToFolder',
  async ({ assetIds, destination, projectPath }, { getState, dispatch }) => {
    const state = getState() as {
      assets: ImageAssets;
    };
    const { images, imageIndexById } = state.assets;

    // Build operation list from current state
    const operations: MoveAssetOperation[] = [];
    for (const id of assetIds) {
      const idx = imageIndexById[id];
      if (idx === undefined) continue;
      const asset = images[idx];
      operations.push({
        fileId: asset.fileId,
        fileExtension: asset.fileExtension,
      });
    }

    const result = await moveAssetsToFolder(
      operations,
      destination,
      projectPath,
    );

    // If collisions, return early — the modal will display the error
    if (result.collisions.length > 0) return result;

    if (result.moved.length > 0) {
      // Surgical Redux state updates
      dispatch({
        type: 'assets/moveAssetsToFolder',
        payload: { moves: result.moved },
      });

      const remaps: Record<string, string> = {};
      for (const m of result.moved) {
        remaps[m.oldFileId] = m.newFileId;
      }
      // Dispatch to selection slice (avoid circular import via barrel)
      dispatch({
        type: 'selection/remapSelectedAssets',
        payload: { remaps },
      });

      if (result.deletedFolders.length > 0) {
        // Dispatch to filters slice (avoid circular import via barrel)
        dispatch({
          type: 'filters/removeSubfolderFilters',
          payload: result.deletedFolders,
        });
      }

      const assetWord = result.moved.length !== 1 ? 'assets' : 'asset';
      dispatch(
        addToast({
          children:
            destination === ARCHIVE_FOLDER
              ? `Archived ${result.moved.length} ${assetWord}`
              : `Moved ${result.moved.length} ${assetWord} to ${destination ?? 'root'}`,
        }),
      );
    }

    return result;
  },
);

/**
 * Discard every asset's natural-language caption when leaving hybrid mode for a
 * tag-only mode. Rewrites the `.txt` files as tags-only (dropping the `__`
 * delimiter and caption) and clears caption state in the store.
 *
 * Only assets with a persisted caption are rewritten, so unrelated files are
 * left untouched. Returns the number of assets whose captions were dropped.
 */
export const stripCaptionsForTagMode = createAsyncThunk<
  { strippedCount: number },
  { projectPath?: string } | undefined,
  { state: { assets: ImageAssets } }
>('assets/stripCaptionsForTagMode', async (options, { getState, dispatch }) => {
  const { images } = getState().assets;

  // Only assets that actually carry a caption on disk need rewriting.
  const withCaptions = images.filter(
    (asset) => asset.savedCaptionText.trim() !== '',
  );

  if (withCaptions.length === 0) {
    return { strippedCount: 0 };
  }

  // Compose tags-only text (mode 'tags' ignores captionText entirely).
  const writeOperations: AssetTagOperation[] = withCaptions.map((asset) => ({
    fileId: asset.fileId,
    composedTags: composeAssetText(asset, 'tags'),
  }));

  await saveMultipleAssetTags(writeOperations, options?.projectPath);

  // Clear caption state across all loaded assets. Dispatched by action-type to
  // avoid a circular import of the slice action through the barrel.
  dispatch({ type: 'assets/clearAllCaptions' });

  return { strippedCount: withCaptions.length };
});
