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

const COLUMN_HEADING_ROW_CLASS =
  'mb-4 flex items-center border-b border-b-slate-200 pb-2 dark:border-b-slate-600';

const COLUMN_HEADING_CLASS =
  'flex items-center text-lg font-semibold text-slate-700 dark:text-slate-200';

const SUBSECTION_HEADING_CLASS =
  'mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-500 dark:text-slate-400';

/** Star + "Favourites" — the per-column favourites subsection heading. */
const FavouritesHeading = () => (
  <h3 className={SUBSECTION_HEADING_CLASS}>
    <StarIcon className="h-4 w-4 text-amber-500 dark:text-amber-400" />
    Favourites
  </h3>
);

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
    featuredTrainingProjects,
    regularTrainingProjects,
    trainingStatus,
    trainingError,
    editingId,
    editName,
    editColor: editTrainingColor,
    editHidden: editTrainingHidden,
    setEditName,
    setEditColor: setEditTrainingColor,
    setEditHidden: setEditTrainingHidden,
    handleSelect: handleTrainingSelect,
    handleStartEdit: handleTrainingStartEdit,
    handleCancelEdit: handleTrainingCancelEdit,
    handleSaveEdit: handleTrainingSaveEdit,
    handleToggleFeatured: handleTrainingToggleFeatured,
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
      editHidden: editTrainingHidden,
      showHidden,
      onSelect: handleTrainingSelect,
      onStartEdit: handleTrainingStartEdit,
      onCancelEdit: handleTrainingCancelEdit,
      onSaveEdit: handleTrainingSaveEdit,
      onNameChange: setEditName,
      onColorChange: setEditTrainingColor,
      onHiddenChange: setEditTrainingHidden,
      onToggleFeatured: handleTrainingToggleFeatured,
    }),
    [
      editTrainingColor,
      editName,
      editTrainingHidden,
      showHidden,
      handleTrainingSelect,
      handleTrainingStartEdit,
      handleTrainingCancelEdit,
      handleTrainingSaveEdit,
      setEditName,
      setEditTrainingColor,
      setEditTrainingHidden,
      handleTrainingToggleFeatured,
    ],
  );

  const renderTaggingItem = (project: (typeof projects)[number]) => (
    <ProjectItem
      key={project.path}
      project={project}
      isEditing={editingProject === project.name}
      isDisabled={isAnyEditing && editingProject !== project.name}
      actions={itemActions}
    />
  );

  const renderTrainingItem = (project: (typeof trainingProjects)[number]) => (
    <TrainingProjectItem
      key={project.id}
      project={project}
      isEditing={editingId === project.id}
      isDisabled={isAnyEditing && editingId !== project.id}
      actions={trainingItemActions}
    />
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
          No registered projects were found in the configured projects folder
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
    <div className="mx-auto flex w-full max-w-5xl min-w-80 flex-col items-center px-4 pt-16 pb-24">
      <FolderClosedIcon className="mb-6 h-24 w-24 text-slate-500 dark:text-slate-400" />

      <h1 className="mb-8 text-2xl text-slate-700 dark:text-slate-200">
        Select a Project
      </h1>

      <div className="grid w-full items-start gap-x-10 gap-y-10 md:grid-cols-2">
        <section>
          <div className={COLUMN_HEADING_ROW_CLASS}>
            <h2 className={COLUMN_HEADING_CLASS}>
              <span className="mr-2 flex items-center justify-center rounded-full border border-slate-300 bg-slate-200 p-2.5 text-slate-700 inset-shadow-sm inset-shadow-slate-50 dark:border-slate-500 dark:bg-slate-600 dark:text-slate-200 dark:inset-shadow-slate-800">
                <FolderClosedIcon className="h-5 w-5" />
              </span>
              Tagging Projects
            </h2>

            <Button
              size="sm"
              width="md"
              color="sky"
              variant="ghost"
              onClick={handleOpenNewProject}
              className="ml-auto"
            >
              <FolderPlusIcon />
              New
            </Button>
          </div>

          {featuredProjects.length > 0 && (
            <div className="mb-6">
              <FavouritesHeading />
              <div className="flex flex-wrap gap-3">
                {featuredProjects.map(renderTaggingItem)}
              </div>
            </div>
          )}

          {regularProjects.length > 0 && (
            <div>
              {featuredProjects.length > 0 && (
                <h3 className={SUBSECTION_HEADING_CLASS}>
                  <FolderClosedIcon className="h-4 w-4" />
                  All Projects
                </h3>
              )}
              <div className="flex flex-wrap gap-3">
                {regularProjects.map(renderTaggingItem)}
              </div>
            </div>
          )}

          {featuredProjects.length === 0 && regularProjects.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No tagging projects found in the projects folder.
            </p>
          )}
        </section>

        <section>
          <div className={COLUMN_HEADING_ROW_CLASS}>
            <h2 className={COLUMN_HEADING_CLASS}>
              <span className="mr-2 flex items-center justify-center rounded-full border border-sky-300 bg-sky-200 p-2.5 text-sky-700 inset-shadow-sm inset-shadow-sky-50 dark:border-sky-500 dark:bg-sky-700 dark:text-sky-200 dark:inset-shadow-sky-900">
                <GpuIcon className="h-5 w-5" />
              </span>
              Training Projects
            </h2>
          </div>

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
          ) : trainingProjects.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No saved training projects yet — use <strong>Save As…</strong> in
              the training workbench to create one.
            </p>
          ) : (
            <>
              {featuredTrainingProjects.length > 0 && (
                <div className="mb-6">
                  <FavouritesHeading />
                  <div className="flex flex-wrap gap-3">
                    {featuredTrainingProjects.map(renderTrainingItem)}
                  </div>
                </div>
              )}

              {regularTrainingProjects.length > 0 && (
                <div>
                  {featuredTrainingProjects.length > 0 && (
                    <h3 className={SUBSECTION_HEADING_CLASS}>
                      <GpuIcon className="h-4 w-4" />
                      All Projects
                    </h3>
                  )}
                  <div className="flex flex-wrap gap-3">
                    {regularTrainingProjects.map(renderTrainingItem)}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <div className="mt-10 flex gap-3">
        <Button onClick={refreshAll} size="md" width="xl">
          Refresh Project List
        </Button>
      </div>

      <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
        Note: only registered folders are listed — New Project also registers an
        existing folder
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
