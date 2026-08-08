// Utility functions for tag state management
import { isArchiveSubfolder } from '../../utils/subfolder-utils';
import { ImageAsset, TagState } from './types';

// Bitwise & 0 would always return 0 so let's check it specifically
export const hasState = (state: number, flag: TagState): boolean =>
  flag === TagState.SAVED ? state === 0 : (state & flag) !== 0;

export const addState = (state: number, flag: TagState): number => state | flag;

/**
 * @public
 */
export const removeState = (state: number, flag: TagState): number =>
  state & ~flag;

export const toggleState = (state: number, flag: TagState): number =>
  state ^ flag;

/**
 * @public For debugging and display purposes only
 */
export const debug_getTagStateString = (state: number): string => {
  if (hasState(state, TagState.SAVED)) return 'Saved';

  const states: string[] = [];
  if (hasState(state, TagState.TO_DELETE)) states.push('ToDelete');
  if (hasState(state, TagState.TO_ADD)) states.push('ToAdd');
  if (hasState(state, TagState.DIRTY)) states.push('Dirty');

  return states.join(', ');
};

/**
 * Re-evaluate DIRTY flags for tags in a given range by comparing
 * current positions against savedTagList. Skips TO_ADD tags.
 */
export const reevaluateDirtyFlags = (
  tagList: string[],
  tagStatus: { [key: string]: number },
  savedTagList: string[],
  startIndex: number,
  endIndex: number,
): void => {
  for (let i = startIndex; i <= endIndex; i++) {
    const tag = tagList[i];
    if (tag && !hasState(tagStatus[tag], TagState.TO_ADD)) {
      const originalIndex = savedTagList.indexOf(tag);
      if (originalIndex === i) {
        tagStatus[tag] = removeState(tagStatus[tag], TagState.DIRTY);
      } else {
        tagStatus[tag] = addState(tagStatus[tag], TagState.DIRTY);
      }
    }
  }
};

/**
 * Mark all existing (non-TO_ADD) tags as DIRTY. Used when tags are
 * prepended, shifting every existing tag's position.
 */
export const markExistingTagsDirty = (tagStatus: {
  [key: string]: number;
}): void => {
  for (const tag of Object.keys(tagStatus)) {
    if (!hasState(tagStatus[tag], TagState.TO_ADD)) {
      tagStatus[tag] = addState(tagStatus[tag], TagState.DIRTY);
    }
  }
};

/**
 * Build a lookup map from fileId to array index for O(1) asset access
 */
export const buildImageIndexMap = (
  images: ImageAsset[],
): { [fileId: string]: number } => {
  const indexMap: { [fileId: string]: number } = {};
  for (let i = 0; i < images.length; i++) {
    indexMap[images[i].fileId] = i;
  }
  return indexMap;
};

/**
 * Build a cached map of tag counts across all assets.
 * Only counts tags that aren't marked for deletion. Archived assets are
 * excluded so their tags don't surface in autocomplete or the Tags view.
 */
export const buildTagCountsCache = (
  images: ImageAsset[],
): { [tag: string]: number } => {
  const tagCounts: { [tag: string]: number } = {};
  for (const asset of images) {
    if (isArchiveSubfolder(asset.subfolder)) continue;
    for (const tag of asset.tagList) {
      // Only count tags that aren't marked for deletion
      if (!hasState(asset.tagStatus[tag], TagState.TO_DELETE)) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }
  }
  return tagCounts;
};
