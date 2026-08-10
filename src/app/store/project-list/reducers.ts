import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { ProjectListState } from './types';

const initialState: ProjectListState = {
  showHidden: false,
  newProjectOpen: false,
  projectsFolder: '',
  refreshToken: 0,
};

const projectListSlice = createSlice({
  name: 'projectList',
  initialState,
  reducers: {
    setShowHidden: (state, action: PayloadAction<boolean>) => {
      state.showHidden = action.payload;
    },
    setNewProjectOpen: (state, action: PayloadAction<boolean>) => {
      state.newProjectOpen = action.payload;
    },
    setProjectsFolder: (state, action: PayloadAction<string>) => {
      state.projectsFolder = action.payload;
    },
    requestProjectListRefresh: (state) => {
      state.refreshToken += 1;
    },
  },
});

export const {
  setShowHidden,
  setNewProjectOpen,
  setProjectsFolder,
  requestProjectListRefresh,
} = projectListSlice.actions;
export const projectListReducer = projectListSlice.reducer;
