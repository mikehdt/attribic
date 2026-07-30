// Extra reducers for handling async thunk actions
import { ActionReducerMapBuilder } from '@reduxjs/toolkit';

import {
  clearLoadErrors,
  clearSaveErrors,
  completeAfterDelay,
  loadAllAssets,
  saveAllAssets,
  saveAsset,
  updateLoadProgress,
  updateSaveProgress,
} from './actions';
import { ImageAssets, IoState } from './types';
import { buildImageIndexMap, buildTagCountsCache } from './utils';

export const setupExtraReducers = (
  builder: ActionReducerMapBuilder<ImageAssets>,
) => {
  // Loading
  builder.addCase(loadAllAssets.pending, (state, action) => {
    const maintainIoState = action.meta.arg?.maintainIoState ?? false;

    // Only change the IoState if not maintaining the current state
    if (!maintainIoState) {
      state.ioState = IoState.LOADING;
      state.ioMessage = 'Loading assets...';
    }

    // The images in the store still belong to the previously-loaded project
    // until this settles, so nothing may be applied against them by fileId
    // while the load is in flight.
    state.loadedProject = null;

    // Initialize the load progress
    // (actual progress will be updated by the client-side code)
    state.loadProgress = {
      total: 0, // Start with 0 until we get the real count from the client
      completed: 0,
      failed: 0,
    };
  });

  builder.addCase(loadAllAssets.fulfilled, (state, action) => {
    state.ioMessage = undefined;
    state.images = action.payload;
    state.imageIndexById = buildImageIndexMap(action.payload);
    // Callers pass the project folder name as `projectPath`.
    state.loadedProject = action.meta.arg?.projectPath ?? null;
    state.tagCountsCache = buildTagCountsCache(action.payload);

    // If progress data shows completion, briefly show 100% before transitioning
    const hasProgressCompletion =
      state.loadProgress &&
      state.loadProgress.total > 0 &&
      state.loadProgress.completed >= state.loadProgress.total;

    if (hasProgressCompletion) {
      state.ioState = IoState.COMPLETING;
    } else {
      state.ioState = IoState.COMPLETE;
      state.loadProgress = undefined;
    }
  });

  builder.addCase(loadAllAssets.rejected, (state, action) => {
    state.ioState = IoState.ERROR;
    state.ioMessage = action.error.message || 'Error loading assets';
    state.images = [];
    state.imageIndexById = {};
    state.loadedProject = null;
    // Keep the progress information for error reporting
    // so users can see how far it got before failing
  });

  // Saving
  builder.addCase(saveAsset.pending, (state, action) => {
    const { arg } = action.meta;
    const fileId = typeof arg === 'string' ? arg : arg.fileId;

    const imageIndex = state.imageIndexById[fileId];
    if (imageIndex === undefined) return;

    state.images[imageIndex].ioState = IoState.SAVING;
    state.ioState = IoState.SAVING;
    state.ioMessage = undefined;
  });

  builder.addCase(saveAsset.fulfilled, (state, action) => {
    state.ioState = IoState.COMPLETE;
    state.ioMessage = undefined;

    const { assetIndex, tagList, tagStatus, savedTagList } = action.payload;

    state.images[assetIndex].ioState = IoState.COMPLETE;
    state.images[assetIndex].tagList = tagList;
    state.images[assetIndex].tagStatus = tagStatus;
    state.images[assetIndex].savedTagList = savedTagList;

    // Apply caption fields if present (caption mode save)
    if (action.payload.captionText !== undefined) {
      state.images[assetIndex].captionText = action.payload.captionText;
      state.images[assetIndex].savedCaptionText =
        action.payload.savedCaptionText ?? action.payload.captionText;
    }

    // Invalidate cache since TO_DELETE tags are removed and TO_ADD become SAVED
    state.tagCountsCache = null;
  });

  builder.addCase(saveAsset.rejected, (state, action) => {
    // A single failed write must not tear down the session (global ERROR
    // unmounts the tagging view and discards every other pending edit).
    // Flag the asset instead — its metadata bar surfaces the failure and the
    // edits stay live for a retry.
    const { arg } = action.meta;
    const fileId = typeof arg === 'string' ? arg : arg.fileId;
    const imageIndex = state.imageIndexById[fileId];
    if (imageIndex !== undefined) {
      state.images[imageIndex].ioState = IoState.ERROR;
    }
    state.ioState = IoState.COMPLETE;
    state.ioMessage = action.error.message;
  });

  // Save All Assets
  builder.addCase(saveAllAssets.pending, (state) => {
    state.ioState = IoState.SAVING;
    state.ioMessage = 'Saving all modified assets...';
    // Initialize the save progress
    state.saveProgress = {
      total: 0, // Will be set in the first updateProgress action
      completed: 0,
      failed: 0,
    };
  });

  builder.addCase(saveAllAssets.fulfilled, (state, action) => {
    // If we have progress data and it shows completion, transition to COMPLETING state first
    if (
      state.saveProgress &&
      state.saveProgress.total > 0 &&
      state.saveProgress.completed >= state.saveProgress.total
    ) {
      state.ioState = IoState.COMPLETING;
    } else {
      // If no progress tracking (e.g., small datasets), go directly to complete
      state.ioState = IoState.COMPLETE;
    }

    // Apply batch updates to assets if results are provided
    if (action.payload.results && action.payload.results.length > 0) {
      action.payload.results.forEach((result) => {
        const { assetIndex, tagList, tagStatus, savedTagList } = result;
        if (state.images[assetIndex]) {
          state.images[assetIndex].ioState = IoState.COMPLETE;
          state.images[assetIndex].tagList = tagList;
          state.images[assetIndex].tagStatus = tagStatus;
          state.images[assetIndex].savedTagList = savedTagList;

          // Apply caption fields if present (caption mode save)
          if (result.captionText !== undefined) {
            state.images[assetIndex].captionText = result.captionText;
            state.images[assetIndex].savedCaptionText =
              result.savedCaptionText ?? result.captionText;
          }
        }
      });
    }

    if (action.payload.savedCount > 0) {
      state.ioMessage = `Successfully saved ${action.payload.savedCount} assets`;
    } else {
      state.ioMessage = 'No assets needed saving';
    }

    if (action.payload.errorCount) {
      state.ioMessage += `, ${action.payload.errorCount} errors`;
    }

    // Don't clear progress yet if we're in COMPLETING state - let the completion action handle it
    if (state.ioState === IoState.COMPLETE) {
      state.saveProgress = undefined;
    }

    // Invalidate cache since TO_DELETE tags are removed and TO_ADD become SAVED
    state.tagCountsCache = null;
  });

  builder.addCase(saveAllAssets.rejected, (state, action) => {
    // Same reasoning as saveAsset.rejected: keep the session alive so the
    // still-dirty assets can be retried. Per-file failures never reject the
    // thunk — this is the whole-batch catastrophic path.
    state.ioState = IoState.COMPLETE;
    state.ioMessage = `Failed to save all assets: ${action.error.message}`;
    state.saveProgress = undefined;
  });

  // Add the updateSaveProgress handler
  builder.addCase(updateSaveProgress, (state, action) => {
    state.saveProgress = action.payload;
  });

  // Add the updateLoadProgress handler
  builder.addCase(updateLoadProgress, (state, action) => {
    state.loadProgress = action.payload;
  });

  // Add handlers for clearing errors
  builder.addCase(clearLoadErrors, (state) => {
    if (state.loadProgress) {
      state.loadProgress.failed = 0;
      state.loadProgress.errors = undefined;
    }
  });

  builder.addCase(clearSaveErrors, (state) => {
    if (state.saveProgress) {
      state.saveProgress.failed = 0;
      state.saveProgress.errors = undefined;
    }
  });

  // Add completion delay handlers
  builder.addCase(completeAfterDelay.pending, () => {
    // State remains COMPLETING during the delay
  });

  builder.addCase(completeAfterDelay.fulfilled, (state) => {
    // Transition to final complete state and clear progress data
    state.ioState = IoState.COMPLETE;
    state.loadProgress = undefined;
    state.saveProgress = undefined;
  });

  builder.addCase(completeAfterDelay.rejected, (state) => {
    // Fallback to complete state if delay fails for any reason
    state.ioState = IoState.COMPLETE;
    state.loadProgress = undefined;
    state.saveProgress = undefined;
  });
};
