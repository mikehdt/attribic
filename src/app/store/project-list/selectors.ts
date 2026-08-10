import type { RootState } from '../index';

export const selectShowHidden = (state: RootState) =>
  state.projectList.showHidden;
export const selectNewProjectOpen = (state: RootState) =>
  state.projectList.newProjectOpen;
export const selectProjectsFolder = (state: RootState) =>
  state.projectList.projectsFolder;
export const selectProjectListRefreshToken = (state: RootState) =>
  state.projectList.refreshToken;
