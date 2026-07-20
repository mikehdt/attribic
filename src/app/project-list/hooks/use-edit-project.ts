import { useCallback, useState } from 'react';

import type { ProjectConfig } from '@/app/services/tagging-projects/fs';
import {
  createProjectThumbnail,
  removeProjectThumbnail,
  updateProject,
} from '@/app/utils/project-actions';

import type { Project, ProjectColor } from '../types';

type UseEditProjectOptions = {
  onError?: (message: string) => void;
};

export const useEditProject = (
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>,
  options?: UseEditProjectOptions,
) => {
  const { onError } = options ?? {};
  const [editingProject, setEditingProject] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editColor, setEditColor] = useState<ProjectColor | undefined>('slate');
  const [editHidden, setEditHidden] = useState(false);

  const handleStartEdit = useCallback((project: Project) => {
    setEditingProject(project.name);
    setEditTitle(project.title || '');
    setEditColor(project.color || 'slate');
    setEditHidden(project.hidden || false);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingProject(null);
    setEditTitle('');
    setEditColor('slate');
    setEditHidden(false);
  }, []);

  const handleSaveEdit = useCallback(
    async (projectName: string) => {
      try {
        const updates: Partial<ProjectConfig> = {};

        // Always include title - empty string will be removed by Server Action, which is what we want
        updates.title = editTitle.trim();

        // Only include color if it's not the default
        if (editColor && editColor !== 'slate') {
          updates.color = editColor;
        }

        // Always send an explicit boolean so unchecking clears it. Passing
        // `undefined` across the Server Action boundary drops the key, which
        // would leave the stored `hidden: true` untouched. updateProject
        // strips falsy flags before writing.
        updates.hidden = editHidden;

        // Update project using Server Action
        await updateProject(projectName, updates);

        // Update the project in the state
        setProjects((prev) =>
          prev.map((project) =>
            project.name === projectName
              ? {
                  ...project,
                  title: editTitle.trim() ? editTitle.trim() : undefined,
                  color: editColor !== 'slate' ? editColor : undefined,
                  hidden: editHidden ? editHidden : undefined,
                }
              : project,
          ),
        );

        // Exit edit mode
        handleCancelEdit();
      } catch (error) {
        console.error('Error saving project edit:', error);
      }
    },
    [editTitle, editColor, editHidden, handleCancelEdit, setProjects],
  );

  const handleToggleFeatured = useCallback(
    async (projectName: string, currentFeatured: boolean) => {
      try {
        // Optimistically update the UI
        setProjects((prev) =>
          prev.map((project) =>
            project.name === projectName
              ? { ...project, featured: !currentFeatured }
              : project,
          ),
        );

        // Update project using Server Action
        await updateProject(projectName, { featured: !currentFeatured });
      } catch (error) {
        console.error('Error toggling featured status:', error);
        // Revert the optimistic update on error
        setProjects((prev) =>
          prev.map((project) =>
            project.name === projectName
              ? { ...project, featured: currentFeatured }
              : project,
          ),
        );
      }
    },
    [setProjects],
  );

  const handleThumbnailSelect = useCallback(
    async (projectName: string, file: File) => {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const result = await createProjectThumbnail(projectName, arrayBuffer);

        // Update the project in state with new thumbnail and version
        setProjects((prev) =>
          prev.map((project) =>
            project.name === projectName
              ? {
                  ...project,
                  thumbnail: true,
                  thumbnailVersion: result.thumbnailVersion,
                }
              : project,
          ),
        );
      } catch (error) {
        console.error('Error creating thumbnail:', error);
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        // Check for common serialisation errors from large files
        if (errorMessage.includes('array nesting')) {
          onError?.('Image file is too large. Please use a smaller image.');
        } else {
          onError?.(`Failed to set thumbnail: ${errorMessage}`);
        }
      }
    },
    [setProjects, onError],
  );

  const handleThumbnailRemove = useCallback(
    async (projectName: string) => {
      try {
        await removeProjectThumbnail(projectName);

        // Update the project in state to remove thumbnail and version
        setProjects((prev) =>
          prev.map((project) =>
            project.name === projectName
              ? {
                  ...project,
                  thumbnail: undefined,
                  thumbnailVersion: undefined,
                }
              : project,
          ),
        );
      } catch (error) {
        console.error('Error removing thumbnail:', error);
      }
    },
    [setProjects],
  );

  return {
    editingProject,
    editTitle,
    editColor,
    editHidden,
    setEditTitle,
    setEditColor,
    setEditHidden,
    handleStartEdit,
    handleCancelEdit,
    handleSaveEdit,
    handleToggleFeatured,
    handleThumbnailSelect,
    handleThumbnailRemove,
  };
};
