import { useCallback, useEffect, useState } from 'react';

import { useToast } from '@/app/shared/toast/hooks/use-toast';
import { resetAssetsState } from '@/app/store/assets';
import { clearFilters } from '@/app/store/filters';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import {
  resetProjectState,
  setCaptionMode,
  setCaptionPrompt,
  setProjectInfo,
  setTriggerPhrases,
} from '@/app/store/project';
import {
  selectNewProjectOpen,
  selectProjectListRefreshToken,
  selectProjectsFolder,
  selectShowHidden,
  setNewProjectOpen,
  setProjectsFolder,
} from '@/app/store/project-list';
import { clearSelection, clearSelectorCaches } from '@/app/store/selection';
import { getProjectList } from '@/app/utils/project-actions';

import type { Project } from '../types';
import { useEditProject } from './use-edit-project';

export const useProjectList = () => {
  const dispatch = useAppDispatch();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const showHidden = useAppSelector(selectShowHidden);
  const projectsFolder = useAppSelector(selectProjectsFolder);
  const isNewProjectOpen = useAppSelector(selectNewProjectOpen);
  const refreshToken = useAppSelector(selectProjectListRefreshToken);
  const { showToast, showErrorToast } = useToast();

  const editActions = useEditProject(setProjects, { onError: showErrorToast });

  const loadProjects = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch current config to get projectsFolder
      const configRes = await fetch('/api/config');
      if (configRes.ok) {
        const config = await configRes.json();
        dispatch(setProjectsFolder(config.projectsFolder ?? ''));
      }

      // Registration is decided server-side: only folders with a
      // `.tagging/project.json` come back, regardless of image count.
      setProjects(await getProjectList());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, [dispatch]);

  const handleOpenNewProject = useCallback(
    () => dispatch(setNewProjectOpen(true)),
    [dispatch],
  );
  const handleCloseNewProject = useCallback(
    () => dispatch(setNewProjectOpen(false)),
    [dispatch],
  );

  const handleProjectCreated = useCallback(
    (folderName: string) => {
      // Refetched rather than pushed into state so the new project picks up the
      // same shape and ordering as the rest of the list.
      loadProjects();
      showToast(`Created project “${folderName}”`);
    },
    [loadProjects, showToast],
  );

  useEffect(() => {
    // Clear all old project data when returning to project selection
    dispatch(resetAssetsState());
    dispatch(resetProjectState());
    dispatch(clearFilters());
    dispatch(clearSelection());
    clearSelectorCaches();
  }, [dispatch]);

  // Loads on mount and again whenever the shelf (folder picker, new-project
  // creation) bumps the shared refresh token.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional data fetch on mount; setState runs after the fetch resolves
    loadProjects();
  }, [loadProjects, refreshToken]);

  // Seeds Redux ahead of the row's Link navigation (the row itself is the
  // anchor now). Only runs for same-tab SPA navigation — a new tab seeds
  // itself from the URL slug via AppProvider.
  const handleProjectSelect = useCallback(
    (projectPath: string) => {
      const selectedProject = projects.find((p) => p.path === projectPath);
      const folderName = projectPath.split(/[/\\]/).pop() || 'Unknown Project';
      const projectTitle = selectedProject?.title || folderName;

      // Set full project info in Redux before navigating — AppProvider won't
      // overwrite this since the folder name will already match
      if (selectedProject?.captionMode) {
        dispatch(setCaptionMode(selectedProject.captionMode));
      }
      if (selectedProject?.triggerPhrases) {
        dispatch(setTriggerPhrases(selectedProject.triggerPhrases));
      }
      // Dispatched unconditionally: AppProvider won't re-seed once the folder
      // name matches, so a project with no authored prompt has to clear the
      // previously-viewed project's value rather than inherit it.
      dispatch(setCaptionPrompt(selectedProject?.captionPrompt ?? null));
      dispatch(
        setProjectInfo({
          name: projectTitle,
          path: projectPath,
          folderName,
          thumbnail: selectedProject?.thumbnail,
        }),
      );
    },
    [dispatch, projects],
  );

  // Separate projects into featured and regular, filtering out hidden projects unless showHidden is true
  const visibleProjects = showHidden
    ? projects
    : projects.filter((project) => !project.hidden);
  const featuredProjects = visibleProjects.filter(
    (project) => project.featured,
  );
  const regularProjects = visibleProjects.filter(
    (project) => !project.featured,
  );

  return {
    loading,
    error,
    projects,
    featuredProjects,
    regularProjects,
    showHidden,
    projectsFolder,
    handleProjectSelect,
    loadProjects,
    isNewProjectOpen,
    handleOpenNewProject,
    handleCloseNewProject,
    handleProjectCreated,
    ...editActions,
  };
};
