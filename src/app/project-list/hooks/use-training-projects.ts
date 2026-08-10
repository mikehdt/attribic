'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { TrainingProjectSummary } from '@/app/services/training-projects/disk-schema';
import type { ProjectColor } from '@/app/shared/project-colors';
import { useToast } from '@/app/shared/toast/hooks/use-toast';
import { useAppSelector } from '@/app/store/hooks';
import {
  selectProjectListRefreshToken,
  selectShowHidden,
} from '@/app/store/project-list';
import { useTrainingProjectList } from '@/app/training/components/project-toolbar/use-training-project-list';
import { slugify } from '@/app/utils/slug';

/**
 * Training projects for the start page: the shared list fetch plus the inline
 * rename/recolour edit state, mirroring what `useEditProject` does for the
 * tagging rows. Structural operations (versions, save-as, delete) stay in the
 * training UI.
 */
export const useTrainingProjects = () => {
  const router = useRouter();
  const { projects, status, error, reload } = useTrainingProjectList(true);
  const refreshToken = useAppSelector(selectProjectListRefreshToken);
  const { showErrorToast } = useToast();

  // The list hook already fetches on mount; only shelf-driven refreshes
  // (folder change, manual refresh) need to re-trigger it.
  const initialToken = useRef(refreshToken);
  useEffect(() => {
    if (refreshToken !== initialToken.current) {
      initialToken.current = refreshToken;
      reload();
    }
  }, [refreshToken, reload]);

  // The endpoint returns most-recent first; the start page lists projects
  // alphabetically like the tagging sections. Natural order so "run 2" sorts
  // before "run 10".
  const sortedProjects = useMemo(
    () =>
      [...projects].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, {
          numeric: true,
          sensitivity: 'base',
        }),
      ),
    [projects],
  );

  const showHidden = useAppSelector(selectShowHidden);
  const visibleProjects = useMemo(
    () =>
      showHidden ? sortedProjects : sortedProjects.filter((p) => !p.hidden),
    [sortedProjects, showHidden],
  );

  const featuredTrainingProjects = useMemo(
    () => visibleProjects.filter((p) => p.featured),
    [visibleProjects],
  );
  const regularTrainingProjects = useMemo(
    () => visibleProjects.filter((p) => !p.featured),
    [visibleProjects],
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState<ProjectColor | undefined>('slate');
  const [editHidden, setEditHidden] = useState(false);

  const handleSelect = useCallback(
    (project: TrainingProjectSummary) => {
      router.push(`/training/${slugify(project.name)}`);
    },
    [router],
  );

  const handleStartEdit = useCallback((project: TrainingProjectSummary) => {
    setEditingId(project.id);
    setEditName(project.name);
    setEditColor(project.color || 'slate');
    setEditHidden(project.hidden || false);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditName('');
    setEditColor('slate');
    setEditHidden(false);
  }, []);

  const handleSaveEdit = useCallback(
    async (projectId: string) => {
      const name = editName.trim();
      if (!name) {
        showErrorToast('Project name cannot be empty');
        return;
      }

      // Send only what changed: an unchanged-name rename still bumps
      // `updatedAt`, which would reshuffle the recent-sort in the load UI.
      const current = projects.find((p) => p.id === projectId);
      // Slate is the default and is stored as "no colour".
      const nextColor = editColor && editColor !== 'slate' ? editColor : null;
      const nameChanged = !current || name !== current.name;
      const colorChanged = (current?.color ?? null) !== nextColor;
      const hiddenChanged = (current?.hidden ?? false) !== editHidden;

      if (!nameChanged && !colorChanged && !hiddenChanged) {
        handleCancelEdit();
        return;
      }

      try {
        const res = await fetch(`/api/training/projects/${projectId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(nameChanged ? { name } : {}),
            ...(colorChanged ? { color: nextColor } : {}),
            ...(hiddenChanged ? { hidden: editHidden } : {}),
          }),
        });
        const data = await res.json();

        if (!res.ok) {
          showErrorToast(data.error || 'Failed to save project');
          return;
        }

        handleCancelEdit();
        reload();
      } catch {
        showErrorToast('Failed to save project');
      }
    },
    [
      editName,
      editColor,
      editHidden,
      projects,
      handleCancelEdit,
      reload,
      showErrorToast,
    ],
  );

  const handleToggleFeatured = useCallback(
    async (project: TrainingProjectSummary) => {
      try {
        const res = await fetch(`/api/training/projects/${project.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ featured: !project.featured }),
        });
        if (!res.ok) {
          const data = await res.json();
          showErrorToast(data.error || 'Failed to update project');
          return;
        }
        reload();
      } catch {
        showErrorToast('Failed to update project');
      }
    },
    [reload, showErrorToast],
  );

  return {
    trainingProjects: sortedProjects,
    featuredTrainingProjects,
    regularTrainingProjects,
    trainingStatus: status,
    trainingError: error,
    editingId,
    editName,
    editColor,
    editHidden,
    setEditName,
    setEditColor,
    setEditHidden,
    handleSelect,
    handleStartEdit,
    handleCancelEdit,
    handleSaveEdit,
    handleToggleFeatured,
  };
};
