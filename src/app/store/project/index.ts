// Main slice definition
import { createSlice } from '@reduxjs/toolkit';

import { coreReducers } from './reducers';
import { ProjectState, TagSortDirection, TagSortType } from './types';

const initialState: ProjectState = {
  info: {
    projectName: undefined,
    projectPath: undefined,
    projectFolderName: undefined,
    projectHasThumbnail: undefined,
    projectThumbnailVersion: undefined,
  },
  config: {
    showCropVisualization: false,
    tagSortType: TagSortType.SORTABLE,
    tagSortDirection: TagSortDirection.ASC,
    captionMode: 'tags',
    triggerPhrases: [],
    captionPrompt: null,
  },
};

const projectSlice = createSlice({
  name: 'project',
  initialState,
  reducers: coreReducers,
  selectors: {
    // Project info selectors
    selectProjectName: (state) => state.info.projectName,
    selectProjectFolderName: (state) => state.info.projectFolderName,
    selectProjectHasThumbnail: (state) => state.info.projectHasThumbnail,
    selectProjectThumbnailVersion: (state) =>
      state.info.projectThumbnailVersion,
    selectProjectInfo: (state) => state.info,

    // Project config selectors
    selectShowCropVisualization: (state) => state.config.showCropVisualization,
    selectTagSortType: (state) => state.config.tagSortType,
    selectTagSortDirection: (state) => state.config.tagSortDirection,
    selectCaptionMode: (state) => state.config.captionMode,
    selectTriggerPhrases: (state) => state.config.triggerPhrases,
    selectCaptionPrompt: (state) => state.config.captionPrompt,
  },
});

// Main exports for slice
export const { reducer: projectReducer } = projectSlice;
export const {
  setProjectInfo,
  resetProjectState,
  toggleCropVisualization,
  setTagSortType,
  setTagSortDirection,
  toggleTagSortDirection,
  setCaptionMode,
  setTriggerPhrases,
  setCaptionPrompt,
} = projectSlice.actions;

// Export the selectors from the slice
export const {
  selectProjectName,
  selectProjectFolderName,
  selectProjectHasThumbnail,
  selectProjectThumbnailVersion,
  selectProjectInfo,
  selectShowCropVisualization,
  selectTagSortType,
  selectTagSortDirection,
  selectCaptionMode,
  selectTriggerPhrases,
  selectCaptionPrompt,
} = projectSlice.selectors;

// Main exports for project module
export * from './types';
