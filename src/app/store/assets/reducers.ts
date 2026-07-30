// Core reducers for the assets slice
import { PayloadAction } from '@reduxjs/toolkit';

import type { CaptionMode } from '../project/types';
import { toggleDirection } from '../utils';
import { composeAssetText, composeSavedText, modeHasCaption } from './helpers';
import { hasHybridDelimiter, splitHybrid } from './hybrid-caption';
import {
  ImageAssets,
  IoState,
  SortDirection,
  SortType,
  TagState,
} from './types';
import {
  addState,
  buildImageIndexMap,
  hasState,
  markExistingTagsDirty,
  reevaluateDirtyFlags,
  removeState,
  toggleState,
} from './utils';

export const coreReducers = {
  // Reset assets to initial state (useful when switching projects)
  resetAssetsState: (state: ImageAssets) => {
    state.ioState = IoState.INITIAL;
    state.ioMessage = undefined;
    state.images = [];
    state.imageIndexById = {};
    state.loadedProject = null;
    state.loadProgress = undefined;
    state.saveProgress = undefined;
    // Reset sorting to defaults
    state.sortType = SortType.NAME;
    state.sortDirection = SortDirection.ASC;
  },

  markFilterTagsToDelete: (
    state: ImageAssets,
    { payload }: PayloadAction<{ tags: string[]; assetIds?: string[] }>,
  ) => {
    const { tags, assetIds } = payload;
    if (!tags || tags.length === 0) return;

    // If assetIds provided, only operate on those assets
    const targetAssetIds = assetIds ? new Set(assetIds) : null;

    // Iterate over images and mark matching tags for deletion
    const filterTagsSet = new Set(tags);

    state.images.forEach((image) => {
      // Skip if we have a scope and this image isn't in it
      if (targetAssetIds && !targetAssetIds.has(image.fileId)) return;

      // Collect TO_ADD tags to remove (modifies tagList, so can't remove inline)
      const toAddTagsToRemove: string[] = [];

      // Set for O(1) lookups instead of O(n) array.includes() per tag
      const tagListSet = new Set(image.tagList);

      tags.forEach((filterTag) => {
        if (!tagListSet.has(filterTag)) return;

        if (hasState(image.tagStatus[filterTag], TagState.TO_ADD)) {
          // TO_ADD tags: remove entirely (they were never saved)
          toAddTagsToRemove.push(filterTag);
        } else {
          // Saved tags: toggle TO_DELETE flag
          image.tagStatus[filterTag] = toggleState(
            image.tagStatus[filterTag],
            TagState.TO_DELETE,
          );
        }
      });

      // Remove TO_ADD tags and re-evaluate DIRTY state for shifted tags
      if (toAddTagsToRemove.length > 0) {
        const savedTagList = image.savedTagList || [];
        // Find the earliest removal index so we only re-evaluate from there
        let earliestRemoved = image.tagList.length;

        for (const tagName of toAddTagsToRemove) {
          const idx = image.tagList.indexOf(tagName);
          if (idx >= 0 && idx < earliestRemoved) {
            earliestRemoved = idx;
          }
          delete image.tagStatus[tagName];
        }

        // Filter out removed tags
        image.tagList = image.tagList.filter(
          (tag) => !filterTagsSet.has(tag) || tag in image.tagStatus,
        );

        // Re-evaluate DIRTY flags from the earliest removal point
        reevaluateDirtyFlags(
          image.tagList,
          image.tagStatus,
          savedTagList,
          earliestRemoved,
          image.tagList.length - 1,
        );
      }
    });

    // Invalidate tag counts cache since TO_DELETE state affects counts
    state.tagCountsCache = null;
  },

  addTag: (
    state: ImageAssets,
    {
      payload,
    }: PayloadAction<{
      assetId: string;
      tagName: string;
      position?: 'start' | 'end';
    }>,
  ) => {
    const { assetId, tagName, position = 'end' } = payload;

    if (tagName.trim() === '') return;

    const imageIndex = state.imageIndexById[assetId];
    if (imageIndex === undefined) return;

    // Even if duplicate tags might exist, we'll only allow adding if not already in the list
    // This prevents inadvertently adding more duplicates
    if (!state.images[imageIndex].tagList.includes(tagName)) {
      if (position === 'start') {
        // Add to the beginning of the list
        state.images[imageIndex].tagList.unshift(tagName);

        // When adding to start, mark all other existing valid tags as DIRTY
        // since their positions have shifted (similar to drag/drop behavior)
        markExistingTagsDirty(state.images[imageIndex].tagStatus);
      } else {
        // Add to the end of the list (default behavior)
        state.images[imageIndex].tagList.push(tagName);
      }

      // Mark the new tag as TO_ADD
      state.images[imageIndex].tagStatus[tagName] = TagState.TO_ADD;

      // Invalidate tag counts cache
      state.tagCountsCache = null;
    }
  },

  addMultipleTags: (
    state: ImageAssets,
    {
      payload,
    }: PayloadAction<{
      assetId: string;
      tagNames: string[];
      position?: 'start' | 'end';
    }>,
  ) => {
    const { assetId, tagNames, position = 'end' } = payload;

    if (tagNames.length === 0) return;

    const imageIndex = state.imageIndexById[assetId];
    if (imageIndex === undefined) return;

    // Filter out tags that already exist and empty tags
    const tagsToAdd = tagNames.filter(
      (tagName) =>
        tagName.trim() !== '' &&
        !state.images[imageIndex].tagList.includes(tagName),
    );

    if (tagsToAdd.length === 0) return;

    // Get current tag status for efficiency
    const currentTagStatus = state.images[imageIndex].tagStatus;

    if (position === 'start') {
      // Add all new tags to the beginning of the list in the order provided
      state.images[imageIndex].tagList.unshift(...tagsToAdd);

      // Mark all other existing valid tags as DIRTY since their positions shifted
      markExistingTagsDirty(currentTagStatus);
    } else {
      // Add all new tags to the end of the list (default behavior)
      state.images[imageIndex].tagList.push(...tagsToAdd);
    }

    // Mark all new tags as TO_ADD
    tagsToAdd.forEach((tagName) => {
      state.images[imageIndex].tagStatus[tagName] = TagState.TO_ADD;
    });

    // Invalidate tag counts cache
    state.tagCountsCache = null;
  },

  editTag: (
    state: ImageAssets,
    {
      payload,
    }: PayloadAction<{
      assetId: string;
      oldTagName: string;
      newTagName: string;
    }>,
  ) => {
    // savedTagList contains the unmodified tags in case of reverting
    const { assetId, oldTagName, newTagName } = payload;

    const assetIndex = state.imageIndexById[assetId];
    if (assetIndex === undefined) return;

    const asset = state.images[assetIndex];

    // Update the name in the tagList
    const tagListIndex = asset.tagList.findIndex((item) => item === oldTagName);
    asset.tagList[tagListIndex] = newTagName;

    const savedIndex = asset.savedTagList?.indexOf(newTagName);

    // Check if this is a revert to the original name AND position
    const isBackToOriginal =
      savedIndex !== undefined &&
      savedIndex !== -1 &&
      savedIndex === tagListIndex;

    // Transfer status flags from old tag to new tag, adjusting DIRTY as needed
    const oldStatus = asset.tagStatus[oldTagName];
    asset.tagStatus[newTagName] = isBackToOriginal
      ? removeState(oldStatus, TagState.DIRTY)
      : addState(oldStatus, TagState.DIRTY);

    delete asset.tagStatus[oldTagName];

    // Invalidate tag counts cache since tag name changed
    state.tagCountsCache = null;
  },

  deleteTag: (
    state: ImageAssets,
    { payload }: PayloadAction<{ assetId: string; tagName: string }>,
  ) => {
    const { assetId, tagName } = payload;

    const assetIndex = state.imageIndexById[assetId];
    if (assetIndex === undefined) return;

    // Stop if no tags to operate on
    if (!state.images[assetIndex]?.tagStatus) return;

    const tagState = state.images[assetIndex].tagStatus[tagName];

    // Handle cases based on the current state
    if (hasState(tagState, TagState.TO_ADD)) {
      // For TO_ADD tags, remove them completely
      const asset = state.images[assetIndex];
      const deletedIndex = asset.tagList.findIndex((item) => item === tagName);

      delete asset.tagStatus[tagName];
      asset.tagList.splice(deletedIndex, 1);

      // Re-evaluate DIRTY state for all tags after the deleted position
      // since their positions may have shifted back to original
      reevaluateDirtyFlags(
        asset.tagList,
        asset.tagStatus,
        asset.savedTagList || [],
        deletedIndex,
        asset.tagList.length - 1,
      );
    } else {
      // Toggle TO_DELETE flag for all other tags
      state.images[assetIndex].tagStatus[tagName] = toggleState(
        tagState,
        TagState.TO_DELETE,
      );
    }

    // Invalidate tag counts cache
    state.tagCountsCache = null;
  },

  reorderTags: (
    state: ImageAssets,
    {
      payload,
    }: PayloadAction<{ assetId: string; oldIndex: number; newIndex: number }>,
  ) => {
    const { assetId, oldIndex, newIndex } = payload;

    // No need to reorder if indexes are the same
    if (oldIndex === newIndex) return;

    const assetIndex = state.imageIndexById[assetId];
    if (assetIndex === undefined) return;

    const asset = state.images[assetIndex];
    const tagList = asset.tagList;
    const tagStatus = asset.tagStatus;

    // Get the tag being moved
    const tagToMove = tagList[oldIndex];

    // Reorder in place - Immer handles immutability
    tagList.splice(oldIndex, 1);
    tagList.splice(newIndex, 0, tagToMove);

    // Re-evaluate DIRTY flags in the affected range
    reevaluateDirtyFlags(
      tagList,
      tagStatus,
      asset.savedTagList || [],
      Math.min(oldIndex, newIndex),
      Math.max(oldIndex, newIndex),
    );
  },

  // Set caption text for a single asset (caption mode editing)
  setCaptionText: (
    state: ImageAssets,
    { payload }: PayloadAction<{ assetId: string; text: string }>,
  ) => {
    const index = state.imageIndexById[payload.assetId];
    if (index === undefined) return;
    state.images[index].captionText = payload.text;
  },

  // Re-derive every loaded asset's caption state for a caption-mode switch, so
  // the caption box shows what the new mode means by "caption" without needing
  // a project reload. Only the caption side moves — tag state is untouched.
  reconcileCaptionsForMode: (
    state: ImageAssets,
    {
      payload: { from, to, ambiguousCaption = 'clear' },
    }: PayloadAction<{
      from: CaptionMode;
      to: CaptionMode;
      /**
       * What to do with caption text that can't be re-derived on the way out of
       * caption mode. See the `from === 'caption'` branch below.
       */
      ambiguousCaption?: 'keep' | 'clear';
    }>,
  ) => {
    if (from === to) return;

    // Entering caption mode: the whole .txt file is the caption, so seed the
    // box with the text this asset's current state would write to disk.
    if (to === 'caption') {
      for (const asset of state.images) {
        asset.captionText = composeAssetText(asset, from);
        asset.savedCaptionText = composeSavedText(asset, from);
      }
      return;
    }

    if (to !== 'hybrid') return;

    // Entering hybrid from a tag-only mode: the file has no caption section, so
    // the caption box starts empty rather than echoing the tag block.
    if (!modeHasCaption(from)) {
      for (const asset of state.images) {
        asset.captionText = '';
        asset.savedCaptionText = '';
      }
      return;
    }

    // Entering hybrid from caption mode. The caption box held the *entire* file
    // body — tag block included — so carrying it across verbatim would make
    // hybrid re-emit those tags after the delimiter, on top of the tag list that
    // was never cleared. Round-tripping the mode switch would then double the
    // text every lap. Re-derive instead:
    //
    //   savedCaptionText is the on-disk body, so re-parsing it as hybrid always
    //   recovers the true caption side (empty for a tags-only file).
    //
    //   captionText only re-parses cleanly when it still carries the delimiter.
    //   Without one it's ambiguous — either a tag block echoed in on the way
    //   into caption mode, or prose the user typed — so the caller decides.
    if (from === 'caption') {
      for (const asset of state.images) {
        asset.savedCaptionText = splitHybrid(asset.savedCaptionText).caption;
        asset.captionText = hasHybridDelimiter(asset.captionText)
          ? splitHybrid(asset.captionText).caption
          : ambiguousCaption === 'keep'
            ? asset.captionText
            : '';
      }
    }
  },

  // Clear the caption on every loaded asset (used when leaving hybrid mode for
  // tag-only mode, after the tags-only files have been rewritten to disk).
  clearAllCaptions: (state: ImageAssets) => {
    for (const asset of state.images) {
      asset.captionText = '';
      asset.savedCaptionText = '';
    }
  },

  resetTags: (state: ImageAssets, { payload }: PayloadAction<string>) => {
    const assetIndex = state.imageIndexById[payload];
    if (assetIndex === undefined) return;

    const asset = state.images[assetIndex];

    // Discarding the edits also discards a lingering failed-save flag
    if (asset.ioState === IoState.ERROR) {
      asset.ioState = IoState.COMPLETE;
    }

    // Also revert caption text (safe in both modes)
    asset.captionText = asset.savedCaptionText;

    const tagStatus = asset.tagStatus;
    const savedList = asset.savedTagList || [];
    const savedTagsSet = new Set(savedList);

    // Remove TO_ADD tags and tags not in savedList from tagStatus
    for (const tag of Object.keys(tagStatus)) {
      if (hasState(tagStatus[tag], TagState.TO_ADD) || !savedTagsSet.has(tag)) {
        delete tagStatus[tag];
      } else {
        // Reset all remaining flags to SAVED state
        tagStatus[tag] = TagState.SAVED;
      }
    }

    // Ensure all tags in savedList have a status entry
    for (const tag of savedList) {
      if (!(tag in tagStatus)) {
        // If a tag from savedList is missing (was likely renamed), recreate it
        tagStatus[tag] = TagState.SAVED;
      }
    }

    // Restore tagList to saved order - Immer handles immutability
    asset.tagList.length = 0;
    asset.tagList.push(...savedList);

    // Invalidate tag counts cache since TO_ADD/TO_DELETE tags are removed
    state.tagCountsCache = null;
  },

  // Reset all modified assets' tags back to their saved state in a single pass
  resetAllModifiedTags: (state: ImageAssets) => {
    let hasReset = false;

    for (const asset of state.images) {
      // Check caption modifications
      const hasCaptionModified = asset.captionText !== asset.savedCaptionText;
      if (hasCaptionModified) {
        asset.captionText = asset.savedCaptionText;
        hasReset = true;
      }

      const hasModified = asset.tagList.some(
        (tag) => !hasState(asset.tagStatus[tag], TagState.SAVED),
      );
      if (!hasModified) continue;

      const savedList = asset.savedTagList || [];
      const savedTagsSet = new Set(savedList);

      // Remove TO_ADD tags and tags not in savedList from tagStatus
      for (const tag of Object.keys(asset.tagStatus)) {
        if (
          hasState(asset.tagStatus[tag], TagState.TO_ADD) ||
          !savedTagsSet.has(tag)
        ) {
          delete asset.tagStatus[tag];
        } else {
          asset.tagStatus[tag] = TagState.SAVED;
        }
      }

      // Ensure all tags in savedList have a status entry
      for (const tag of savedList) {
        if (!(tag in asset.tagStatus)) {
          asset.tagStatus[tag] = TagState.SAVED;
        }
      }

      // Restore tagList to saved order
      asset.tagList.length = 0;
      asset.tagList.push(...savedList);
      hasReset = true;
    }

    if (hasReset) {
      state.tagCountsCache = null;
    }
  },

  // Sorting reducers
  setSortType: (state: ImageAssets, { payload }: PayloadAction<SortType>) => {
    state.sortType = payload;
  },

  setSortDirection: (
    state: ImageAssets,
    { payload }: PayloadAction<SortDirection>,
  ) => {
    state.sortDirection = payload;
  },

  toggleSortDirection: (state: ImageAssets) => {
    state.sortDirection = toggleDirection(
      state.sortDirection,
      SortDirection.ASC,
      SortDirection.DESC,
    );
  },

  /**
   * Gathers selected tags to be consecutive, starting at the position of the first selected tag.
   * Works per-asset: gathers whichever of the selected tags are present in that asset.
   * For example: [a] [b] [c] [d] [e] with [b], [d], [e] selected becomes [a] [b] [d] [e] [c]
   */
  gatherTags: (
    state: ImageAssets,
    { payload }: PayloadAction<{ tags: string[]; assetIds?: string[] }>,
  ) => {
    const { tags, assetIds } = payload;
    if (!tags || tags.length < 2) return;

    const tagsToGather = tags;

    // If assetIds provided, only operate on those assets
    const targetAssetIds = assetIds ? new Set(assetIds) : null;

    state.images.forEach((asset) => {
      // Skip if we have a scope and this asset isn't in it
      if (targetAssetIds && !targetAssetIds.has(asset.fileId)) return;
      // Find which of the selected tags exist in this asset (Set for O(1) lookup)
      const tagListSet = new Set(asset.tagList);
      const presentTags = tagsToGather.filter((tag) => tagListSet.has(tag));

      // Need at least 2 tags present in this asset to gather
      if (presentTags.length < 2) return;

      const presentTagsSet = new Set(presentTags);

      // Find the index of the first tag to gather (in current tag order)
      const firstTagIndex = Math.min(
        ...presentTags.map((tag) => asset.tagList.indexOf(tag)),
      );

      // Get tags in their current order within the asset
      const orderedTagsToGather = asset.tagList.filter((tag) =>
        presentTagsSet.has(tag),
      );

      // Remove all tags to gather from their current positions
      asset.tagList = asset.tagList.filter((tag) => !presentTagsSet.has(tag));

      // Insert them consecutively at the first tag's original position
      asset.tagList.splice(firstTagIndex, 0, ...orderedTagsToGather);

      // Re-evaluate DIRTY flags for all tags
      reevaluateDirtyFlags(
        asset.tagList,
        asset.tagStatus,
        asset.savedTagList || [],
        0,
        asset.tagList.length - 1,
      );
    });
  },

  /**
   * Copies tags from one asset (donor) to multiple target assets (recipients).
   * Only adds tags that don't already exist in each target asset.
   * New tags are marked with TO_ADD state.
   */
  copyTagsToAssets: (
    state: ImageAssets,
    {
      payload,
    }: PayloadAction<{
      tags: string[];
      targetAssetIds: string[];
      position?: 'start' | 'end';
    }>,
  ) => {
    const { tags, targetAssetIds, position = 'end' } = payload;

    if (tags.length === 0 || targetAssetIds.length === 0) return;

    targetAssetIds.forEach((assetId) => {
      const assetIndex = state.imageIndexById[assetId];
      if (assetIndex === undefined) return;

      const asset = state.images[assetIndex];

      // Set for O(1) lookups instead of O(n) array.includes() per tag
      const existingTags = new Set(asset.tagList);

      // Filter to tags that don't already exist in this asset
      const tagsToAdd = tags.filter(
        (tag) => tag.trim() !== '' && !existingTags.has(tag),
      );

      if (tagsToAdd.length === 0) return;

      if (position === 'start') {
        // Add to the beginning of the list
        asset.tagList.unshift(...tagsToAdd);

        // Mark all existing tags as DIRTY since their positions have shifted
        markExistingTagsDirty(asset.tagStatus);
      } else {
        // Append new tags to the end
        asset.tagList.push(...tagsToAdd);
      }

      // Mark all new tags as TO_ADD
      tagsToAdd.forEach((tag) => {
        asset.tagStatus[tag] = TagState.TO_ADD;
      });
    });

    // Invalidate tag counts cache
    state.tagCountsCache = null;
  },

  // Move assets to a different folder — updates fileId, subfolder, and rebuilds index
  moveAssetsToFolder: (
    state: ImageAssets,
    {
      payload,
    }: PayloadAction<{
      moves: Array<{
        oldFileId: string;
        newFileId: string;
        newSubfolder: string | undefined;
      }>;
    }>,
  ) => {
    for (const { oldFileId, newFileId, newSubfolder } of payload.moves) {
      const index = state.imageIndexById[oldFileId];
      if (index === undefined) continue;
      state.images[index].fileId = newFileId;
      state.images[index].subfolder = newSubfolder;
    }
    state.imageIndexById = buildImageIndexMap(state.images);
    state.tagCountsCache = null;
  },
};
