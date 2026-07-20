// Core reducers for the project slice
import { PayloadAction } from '@reduxjs/toolkit';

import { toggleDirection } from '../utils';
import {
  CaptionMode,
  ProjectState,
  TagSortDirection,
  TagSortType,
} from './types';

export const coreReducers = {
  // Set project information
  setProjectInfo: (
    state: ProjectState,
    {
      payload,
    }: PayloadAction<{
      name: string;
      path: string;
      folderName: string;
      thumbnail?: boolean;
      thumbnailVersion?: number;
    }>,
  ) => {
    state.info.projectName = payload.name;
    state.info.projectPath = payload.path;
    state.info.projectFolderName = payload.folderName;
    state.info.projectHasThumbnail = payload.thumbnail;
    state.info.projectThumbnailVersion = payload.thumbnailVersion;
  },

  // Reset project to initial state (useful when switching projects)
  resetProjectState: (state: ProjectState) => {
    state.info.projectName = undefined;
    state.info.projectPath = undefined;
    state.info.projectFolderName = undefined;
    state.info.projectHasThumbnail = undefined;
    state.info.projectThumbnailVersion = undefined;
    // Reset config to defaults when switching projects
    state.config.showCropVisualization = false;
    state.config.tagSortType = TagSortType.SORTABLE;
    state.config.tagSortDirection = TagSortDirection.ASC;
    state.config.captionMode = 'tags';
    state.config.triggerPhrases = [];
    state.config.captionPrompt = null;
  },

  // Toggle crop visualisation
  toggleCropVisualization: (state: ProjectState) => {
    state.config.showCropVisualization = !state.config.showCropVisualization;
  },

  // Set tag sort type
  setTagSortType: (
    state: ProjectState,
    { payload }: PayloadAction<TagSortType>,
  ) => {
    state.config.tagSortType = payload;
  },

  // Set tag sort direction
  setTagSortDirection: (
    state: ProjectState,
    { payload }: PayloadAction<TagSortDirection>,
  ) => {
    state.config.tagSortDirection = payload;
  },

  // Toggle tag sort direction
  toggleTagSortDirection: (state: ProjectState) => {
    state.config.tagSortDirection = toggleDirection(
      state.config.tagSortDirection,
      TagSortDirection.ASC,
      TagSortDirection.DESC,
    );
  },

  // Set caption mode
  setCaptionMode: (
    state: ProjectState,
    { payload }: PayloadAction<CaptionMode>,
  ) => {
    state.config.captionMode = payload;
  },

  // Set trigger phrases for caption highlighting
  setTriggerPhrases: (
    state: ProjectState,
    { payload }: PayloadAction<string[]>,
  ) => {
    state.config.triggerPhrases = payload;
  },

  // Set the project's canonical captioning prompt. `null` restores the
  // built-in default for future runs.
  setCaptionPrompt: (
    state: ProjectState,
    { payload }: PayloadAction<string | null>,
  ) => {
    state.config.captionPrompt = payload;
  },
};
