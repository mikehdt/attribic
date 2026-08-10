import { CheckIcon, PencilIcon, XIcon } from 'lucide-react';
import { memo, useEffect, useRef } from 'react';

import { Button } from '@/app/shared/button';
import { Checkbox } from '@/app/shared/checkbox';
import { ColorSwatchRow } from '@/app/shared/color-swatch-row';
import type { ProjectColor } from '@/app/shared/project-colors';

import { ProjectIcon } from './project-icon';
import type { Project } from './types';

export type ProjectItemActions = {
  editColor: ProjectColor | undefined;
  editTitle: string;
  editHidden: boolean;
  showHidden: boolean;
  onSelect: (path: string) => void;
  onStartEdit: (project: Project) => void;
  onCancelEdit: () => void;
  onSaveEdit: (projectName: string) => void;
  onTitleChange: (title: string) => void;
  onColorChange: (color: ProjectColor | undefined) => void;
  onHiddenChange: (hidden: boolean) => void;
  onToggleFeatured: (projectName: string, currentFeatured: boolean) => void;
  onThumbnailSelect: (projectName: string, file: File) => void;
  onThumbnailRemove: (projectName: string) => void;
};

type ProjectItemProps = {
  project: Project;
  isEditing: boolean;
  isDisabled: boolean;
  actions: ProjectItemActions;
};

const ProjectItemComponent = ({
  project,
  isEditing,
  isDisabled,
  actions,
}: ProjectItemProps) => {
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditing]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      actions.onSaveEdit(project.name);
    } else if (e.key === 'Escape') {
      actions.onCancelEdit();
    }
  };

  return (
    <Button
      onClick={() => actions.onSelect(project.path)}
      size="lg"
      width="lg"
      color={isEditing ? actions.editColor : project.color || 'slate'}
      inert={isEditing}
      className={`group w-full justify-start p-4 text-left transition-opacity duration-200 ${actions.showHidden && project.hidden && !isEditing && !isDisabled ? 'opacity-50' : ''} ${isDisabled ? 'pointer-events-none opacity-35' : ''}`}
    >
      <div className="flex w-full items-center">
        <ProjectIcon
          project={project}
          isEditing={isEditing}
          onToggleFeatured={actions.onToggleFeatured}
          onThumbnailSelect={(file) =>
            actions.onThumbnailSelect(project.name, file)
          }
          onThumbnailRemove={() => actions.onThumbnailRemove(project.name)}
        />

        {isEditing ? (
          <div className="flex min-w-0 flex-1 items-center justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <input
                ref={titleInputRef}
                type="text"
                value={actions.editTitle}
                onChange={(e) => actions.onTitleChange(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm font-medium text-slate-700 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-500 dark:bg-slate-600 dark:text-slate-100 dark:placeholder-slate-400"
                placeholder={`Project title for ${project.name}`}
              />

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-600 dark:text-slate-300">
                  Colour:
                </span>
                <ColorSwatchRow
                  value={actions.editColor}
                  onChange={actions.onColorChange}
                  className="mr-auto"
                />

                <Checkbox
                  isSelected={actions.editHidden || false}
                  onChange={() => actions.onHiddenChange(!actions.editHidden)}
                  ariaLabel="Hide project from list"
                  label="Hide"
                  size="sm"
                />
              </div>
            </div>

            <div className="ml-2 flex items-center gap-1">
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  actions.onSaveEdit(project.name);
                }}
                className="cursor-pointer rounded border border-teal-300/0 p-1 text-teal-600 transition-colors hover:border-teal-300 hover:bg-teal-50 dark:text-teal-400 dark:hover:border-teal-500 dark:hover:bg-teal-900/50"
                title="Save changes"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    actions.onSaveEdit(project.name);
                  }
                }}
              >
                <CheckIcon />
              </div>
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  actions.onCancelEdit();
                }}
                className="cursor-pointer rounded border border-rose-300/0 p-1 text-rose-600 transition-colors hover:border-rose-300 hover:bg-red-50 dark:text-rose-400 dark:hover:border-rose-500 dark:hover:bg-rose-900/50"
                title="Cancel"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    actions.onCancelEdit();
                  }
                }}
              >
                <XIcon className="h-3 w-3" />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center justify-between">
            <div className="flex flex-wrap font-medium text-slate-900 dark:text-slate-100">
              <span className="w-full truncate">
                {project.title || project.name}
              </span>
              {project.title && (
                <span className="w-full text-xs text-black/40 dark:text-white/40">
                  {project.name}
                </span>
              )}
            </div>

            <div className="relative flex items-center">
              {project.imageCount !== undefined && (
                <div className="text-sm text-nowrap text-slate-500 tabular-nums transition-transform duration-200 group-hover:-translate-x-8 dark:text-slate-300">
                  {project.imageCount === 1
                    ? `1 image`
                    : `${project.imageCount} images`}
                </div>
              )}
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  actions.onStartEdit(project);
                }}
                className="absolute right-0 cursor-pointer rounded border border-slate-300/0 p-1 text-slate-400 opacity-0 transition-colors duration-200 group-hover:opacity-100 hover:border-slate-300 hover:bg-white hover:text-slate-600 dark:text-slate-300 dark:hover:border-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                title="Edit project"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    actions.onStartEdit(project);
                  }
                }}
              >
                <PencilIcon />
              </div>
            </div>
          </div>
        )}
      </div>
    </Button>
  );
};

export const ProjectItem = memo(ProjectItemComponent);
