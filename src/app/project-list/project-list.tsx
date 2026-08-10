'use client';

import {
  FolderClosedIcon,
  FolderPlusIcon,
  FolderXIcon,
  GpuIcon,
  StarIcon,
} from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { Button } from '@/app/shared/button';
import { useAppDispatch } from '@/app/store/hooks';
import { requestProjectListRefresh } from '@/app/store/project-list';

import { useProjectList } from './hooks/use-project-list';
import { useTrainingProjects } from './hooks/use-training-projects';
import { NewProjectModal } from './new-project-modal/new-project-modal';
import { ProjectItem, type ProjectItemActions } from './project-item';
import { ProjectsFolderInline } from './projects-folder-button';
import {
  TrainingProjectItem,
  type TrainingProjectItemActions,
} from './training-project-item';

const SECTION_HEADING_CLASS =
  'mb-2 flex items-center border-b border-b-slate-200 pb-2 text-lg font-semibold text-slate-700 dark:border-b-slate-600 dark:text-slate-200';

export const ProjectList = () => {
  const dispatch = useAppDispatch();
  const {
    loading,
    error,
    projects,
    featuredProjects,
    regularProjects,
    showHidden,
    projectsFolder,
    handleProjectSelect,
    isNewProjectOpen,
    handleOpenNewProject,
    handleCloseNewProject,
    handleProjectCreated,
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
  } = useProjectList();

  const {
    trainingProjects,
    trainingStatus,
    trainingError,
    editingId,
    editName,
    editColor: editTrainingColor,
    setEditName,
    setEditColor: setEditTrainingColor,
    handleSelect: handleTrainingSelect,
    handleStartEdit: handleTrainingStartEdit,
    handleCancelEdit: handleTrainingCancelEdit,
    handleSaveEdit: handleTrainingSaveEdit,
  } = useTrainingProjects();

  const refreshAll = useCallback(
    () => dispatch(requestProjectListRefresh()),
    [dispatch],
  );

  const isAnyEditing = editingProject !== null || editingId !== null;

  const itemActions: ProjectItemActions = useMemo(
    () => ({
      editColor,
      editTitle,
      editHidden,
      showHidden,
      onSelect: handleProjectSelect,
      onStartEdit: handleStartEdit,
      onCancelEdit: handleCancelEdit,
      onSaveEdit: handleSaveEdit,
      onTitleChange: setEditTitle,
      onColorChange: setEditColor,
      onHiddenChange: setEditHidden,
      onToggleFeatured: handleToggleFeatured,
      onThumbnailSelect: handleThumbnailSelect,
      onThumbnailRemove: handleThumbnailRemove,
    }),
    [
      editColor,
      editTitle,
      editHidden,
      showHidden,
      handleProjectSelect,
      handleStartEdit,
      handleCancelEdit,
      handleSaveEdit,
      setEditTitle,
      setEditColor,
      setEditHidden,
      handleToggleFeatured,
      handleThumbnailSelect,
      handleThumbnailRemove,
    ],
  );

  const trainingItemActions: TrainingProjectItemActions = useMemo(
    () => ({
      editColor: editTrainingColor,
      editName,
      onSelect: handleTrainingSelect,
      onStartEdit: handleTrainingStartEdit,
      onCancelEdit: handleTrainingCancelEdit,
      onSaveEdit: handleTrainingSaveEdit,
      onNameChange: setEditName,
      onColorChange: setEditTrainingColor,
    }),
    [
      editTrainingColor,
      editName,
      handleTrainingSelect,
      handleTrainingStartEdit,
      handleTrainingCancelEdit,
      handleTrainingSaveEdit,
      setEditName,
      setEditTrainingColor,
    ],
  );

  if (loading || (projects.length === 0 && trainingStatus === 'loading')) {
    return (
      <div className="mx-auto flex w-full max-w-120 min-w-80 flex-wrap justify-center px-4 text-center">
        <FolderClosedIcon
          size={320}
          className="max-w-80 text-slate-500 dark:text-slate-400"
        />
        <h1 className="mt-4 w-full text-xl text-slate-500 dark:text-slate-400">
          Loading projects&hellip;
        </h1>
      </div>
    );
  } else if (error) {
    return (
      <div className="mx-auto flex w-full max-w-120 min-w-80 flex-wrap justify-center px-4 text-center">
        <FolderClosedIcon
          size={320}
          className="max-w-80 text-slate-500 dark:text-slate-400"
        />
        <h1 className="mt-4 mb-4 w-full text-xl text-slate-500 dark:text-slate-400">
          Error loading projects
        </h1>
        <p className="mt-4 w-full text-rose-500 dark:text-rose-400">{error}</p>
        <ProjectsFolderInline />
        <p className="mt-4 flex w-full justify-center">
          <Button onClick={refreshAll} size="md" width="xl">
            Refresh
          </Button>
        </p>
      </div>
    );
  } else if (projects.length === 0 && trainingProjects.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-120 min-w-80 flex-wrap justify-center px-4 text-center">
        <FolderXIcon
          size={320}
          className="max-w-80 text-slate-500 dark:text-slate-400"
        />
        <h1 className="mt-4 mb-4 w-full text-xl text-slate-500 dark:text-slate-400">
          No projects found
        </h1>
        <p className="mt-4 w-full text-slate-600 dark:text-slate-400">
          No project folders were found in the configured projects directory
        </p>
        <ProjectsFolderInline />
        <p className="mt-4 flex w-full justify-center gap-3">
          <Button onClick={refreshAll} size="md" width="xl">
            Refresh
          </Button>
          <Button
            onClick={handleOpenNewProject}
            color="sky"
            size="md"
            width="xl"
          >
            <FolderPlusIcon />
            New Project
          </Button>
        </p>

        <NewProjectModal
          isOpen={isNewProjectOpen}
          onClose={handleCloseNewProject}
          projectsFolder={projectsFolder}
          onCreated={handleProjectCreated}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-120 min-w-80 flex-col items-center px-4 pt-16 pb-24">
      <FolderClosedIcon className="mb-6 h-24 w-24 text-slate-500 dark:text-slate-400" />

      <h1 className="mb-8 text-2xl text-slate-700 dark:text-slate-200">
        Select a Project
      </h1>

      <div className="w-full max-w-md">
        {featuredProjects.length > 0 && (
          <div className="mb-8">
            <h2 className={SECTION_HEADING_CLASS}>
              <span className="mr-2 flex items-center justify-center rounded-full border border-amber-300 bg-amber-200 p-2.5 text-amber-700 inset-shadow-sm inset-shadow-amber-50 dark:border-amber-500 dark:bg-amber-700 dark:text-amber-200 dark:inset-shadow-amber-900">
                <StarIcon className="h-5 w-5" />
              </span>
              Favourite Projects
            </h2>
            <div className="flex flex-wrap gap-3">
              {featuredProjects.map((project) => (
                <ProjectItem
                  key={project.path}
                  project={project}
                  isEditing={editingProject === project.name}
                  isDisabled={isAnyEditing && editingProject !== project.name}
                  actions={itemActions}
                />
              ))}
            </div>
          </div>
        )}

        {regularProjects.length > 0 && (
          <div className="mb-8">
            <h2 className={SECTION_HEADING_CLASS}>
              <span className="mr-2 flex items-center justify-center rounded-full border border-slate-300 bg-slate-200 p-2.5 text-slate-700 inset-shadow-sm inset-shadow-slate-50 dark:border-slate-500 dark:bg-slate-600 dark:text-slate-200 dark:inset-shadow-slate-800">
                <FolderClosedIcon className="h-5 w-5" />
              </span>
              {featuredProjects.length > 0
                ? 'Other Tagging Projects'
                : 'Tagging Projects'}
            </h2>
            <div className="flex flex-wrap gap-3">
              {regularProjects.map((project) => (
                <ProjectItem
                  key={project.path}
                  project={project}
                  isEditing={editingProject === project.name}
                  isDisabled={isAnyEditing && editingProject !== project.name}
                  actions={itemActions}
                />
              ))}
            </div>
          </div>
        )}

        {(trainingProjects.length > 0 || trainingStatus === 'error') && (
          <div className="mb-8">
            <h2 className={SECTION_HEADING_CLASS}>
              <span className="mr-2 flex items-center justify-center rounded-full border border-sky-300 bg-sky-200 p-2.5 text-sky-700 inset-shadow-sm inset-shadow-sky-50 dark:border-sky-500 dark:bg-sky-700 dark:text-sky-200 dark:inset-shadow-sky-900">
                <GpuIcon className="h-5 w-5" />
              </span>
              Training Projects
            </h2>
            {trainingStatus === 'error' ? (
              <p className="text-sm text-rose-500 dark:text-rose-400">
                Couldn&rsquo;t load training projects
                {trainingError ? ` — ${trainingError}` : ''}.{' '}
                <button
                  type="button"
                  onClick={refreshAll}
                  className="cursor-pointer underline"
                >
                  Retry
                </button>
              </p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {trainingProjects.map((project) => (
                  <TrainingProjectItem
                    key={project.id}
                    project={project}
                    isEditing={editingId === project.id}
                    isDisabled={isAnyEditing && editingId !== project.id}
                    actions={trainingItemActions}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 flex gap-3">
        <Button onClick={refreshAll} size="md" width="xl">
          Refresh Project List
        </Button>
      </div>

      <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
        Note: project folders with no images are not shown, unless created here
      </p>

      <NewProjectModal
        isOpen={isNewProjectOpen}
        onClose={handleCloseNewProject}
        projectsFolder={projectsFolder}
        onCreated={handleProjectCreated}
      />
    </div>
  );
};
