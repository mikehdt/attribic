import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useToast } from '@/app/shared/toast/hooks/use-toast';
import { resetAssetsState } from '@/app/store/assets';
import { clearFilters } from '@/app/store/filters';
import { useAppDispatch } from '@/app/store/hooks';
import {
  resetProjectState,
  setCaptionMode,
  setCaptionPrompt,
  setProjectInfo,
  setTriggerPhrases,
} from '@/app/store/project';
import { clearSelection, clearSelectorCaches } from '@/app/store/selection';
import { getProjectList } from '@/app/utils/project-actions';

import type { Project } from '../types';
import { useEditProject } from './use-edit-project';

export const useProjectList = () => {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [projectsFolder, setProjectsFolder] = useState('');
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
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
        setProjectsFolder(config.projectsFolder ?? '');
      }

      // Call server action to get project list (always include hidden, but not private)
      const projectData = await getProjectList();
      // Asset-less folders are dropped — the projects root usually holds
      // unrelated folders too — except where the project opted out of that with
      // `showWhenEmpty`, which is how a newly created project stays visible.
      setProjects(
        projectData.filter(
          (project) => project?.imageCount || project?.showWhenEmpty,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSaveProjectsFolder = useCallback(
    async (folder: string): Promise<{ error?: string }> => {
      try {
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectsFolder: folder }),
        });

        const data = await res.json();

        if (!res.ok) {
          return { error: data.error || 'Failed to save' };
        }

        setProjectsFolder(folder);
        // Reload projects from the new folder
        loadProjects();
        return {};
      } catch {
        return { error: 'Failed to save projects folder' };
      }
    },
    [loadProjects],
  );

  const handleOpenNewProject = useCallback(() => setIsNewProjectOpen(true), []);
  const handleCloseNewProject = useCallback(
    () => setIsNewProjectOpen(false),
    [],
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

    // Then load the project list
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional data fetch on mount; setState runs after the fetch resolves
    loadProjects();
  }, [loadProjects, dispatch]);

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

      router.push(`/tagging/${encodeURIComponent(folderName)}/1`);
    },
    [router, dispatch, projects],
  );

  // Separate projects into featured and regular, filtering out hidden projects unless showHidden is true
  // Always filter out private projects regardless of showHidden state
  const nonPrivateProjects = projects.filter((project) => !project.private);
  const visibleProjects = showHidden
    ? nonPrivateProjects
    : nonPrivateProjects.filter((project) => !project.hidden);
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
    setShowHidden,
    projectsFolder,
    handleSaveProjectsFolder,
    handleProjectSelect,
    loadProjects,
    isNewProjectOpen,
    handleOpenNewProject,
    handleCloseNewProject,
    handleProjectCreated,
    ...editActions,
  };
};
