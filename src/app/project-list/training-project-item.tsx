import { CheckIcon, GpuIcon, PencilIcon, StarIcon, XIcon } from 'lucide-react';
import Image from 'next/image';
import { memo, useEffect, useRef, useState } from 'react';

import { TRAINING_PROVIDER_SHORT_LABELS } from '@/app/services/training/types';
import type {
  TrainingProjectSummary,
  TrainingProjectVersionSummary,
} from '@/app/services/training-projects/disk-schema';
import { Button } from '@/app/shared/button';
import { Checkbox } from '@/app/shared/checkbox';
import { ColorSwatchRow } from '@/app/shared/color-swatch-row';
import type { ProjectColor } from '@/app/shared/project-colors';
import { modelLabel } from '@/app/training/components/project-toolbar/model-backend-badges';
import { projectThumbnailSrc } from '@/app/utils/project-thumbnail';

export type TrainingProjectItemActions = {
  editColor: ProjectColor | undefined;
  editName: string;
  editHidden: boolean;
  showHidden: boolean;
  onSelect: (project: TrainingProjectSummary) => void;
  onStartEdit: (project: TrainingProjectSummary) => void;
  onCancelEdit: () => void;
  onSaveEdit: (projectId: string) => void;
  onNameChange: (name: string) => void;
  onColorChange: (color: ProjectColor | undefined) => void;
  onHiddenChange: (hidden: boolean) => void;
  onToggleFeatured: (project: TrainingProjectSummary) => void;
};

type TrainingProjectItemProps = {
  project: TrainingProjectSummary;
  isEditing: boolean;
  isDisabled: boolean;
  actions: TrainingProjectItemActions;
};

/** Highest-numbered version — the one whose datasets represent the project. */
const latestVersionOf = (
  project: TrainingProjectSummary,
): TrainingProjectVersionSummary | null =>
  project.versions.reduce<TrainingProjectVersionSummary | null>(
    (best, v) => (!best || v.version > best.version ? v : best),
    null,
  );

/**
 * A 40px circle matching ProjectIcon's footprint: the first dataset thumbnail
 * of the latest version, or a GPU icon when no dataset has one. Hovering it
 * offers the same featured-star toggle as tagging rows.
 */
const TrainingProjectIcon = ({
  project,
  isEditing,
  onToggleFeatured,
}: {
  project: TrainingProjectSummary;
  isEditing: boolean;
  onToggleFeatured: (project: TrainingProjectSummary) => void;
}) => {
  const [isHovering, setIsHovering] = useState(false);
  // A saved summary can claim a thumbnail that has since been removed from the
  // tagging project it borrows from — fall back to the icon on a failed load.
  const [thumbFailed, setThumbFailed] = useState(false);
  const thumb = latestVersionOf(project)?.datasets.find(
    (d) => d.thumbnail && d.folderName,
  );

  return (
    <span
      className="relative mr-3 h-10 w-10 shrink-0"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-white dark:bg-slate-600">
        {thumb?.folderName && !thumbFailed ? (
          <Image
            src={projectThumbnailSrc(thumb.folderName, thumb.thumbnailVersion)}
            alt={project.name}
            width={40}
            height={40}
            className="h-full w-full object-cover"
            onError={() => setThumbFailed(true)}
          />
        ) : (
          <GpuIcon className="h-5 w-5 text-slate-500 dark:text-slate-300" />
        )}
      </span>

      {!isEditing && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            onToggleFeatured(project);
          }}
          className={`absolute inset-0 flex cursor-pointer items-center justify-center rounded-full transition-opacity duration-200 ${isHovering ? 'border opacity-100' : 'opacity-0'} ${project.featured ? 'border-slate-300 bg-white dark:border-slate-500 dark:bg-slate-600' : 'border-amber-400 bg-amber-100 dark:border-amber-500 dark:bg-amber-800'}`}
          title={
            project.featured ? 'Remove from favourites' : 'Add to favourites'
          }
        >
          {project.featured ? (
            <StarIcon className="h-5 w-5 text-slate-600 dark:text-slate-300" />
          ) : (
            <StarIcon className="h-5 w-5 fill-current text-amber-500 dark:text-amber-400" />
          )}
        </div>
      )}
    </span>
  );
};

const TrainingProjectItemComponent = ({
  project,
  isEditing,
  isDisabled,
  actions,
}: TrainingProjectItemProps) => {
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [isEditing]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      actions.onSaveEdit(project.id);
    } else if (e.key === 'Escape') {
      actions.onCancelEdit();
    }
  };

  const latest = latestVersionOf(project);

  return (
    <Button
      onClick={() => actions.onSelect(project)}
      size="lg"
      width="lg"
      color={isEditing ? actions.editColor : project.color || 'slate'}
      inert={isEditing}
      className={`group w-full justify-start p-4 text-left transition-opacity duration-200 ${actions.showHidden && project.hidden && !isEditing && !isDisabled ? 'opacity-50' : ''} ${isDisabled ? 'pointer-events-none opacity-35' : ''}`}
    >
      <div className="flex w-full items-center">
        <TrainingProjectIcon
          project={project}
          isEditing={isEditing}
          onToggleFeatured={actions.onToggleFeatured}
        />

        {isEditing ? (
          <div className="flex min-w-0 flex-1 items-center justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <input
                ref={nameInputRef}
                type="text"
                value={actions.editName}
                onChange={(e) => actions.onNameChange(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm font-medium text-slate-700 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-500 dark:bg-slate-600 dark:text-slate-100 dark:placeholder-slate-400"
                placeholder="Project name"
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
                  actions.onSaveEdit(project.id);
                }}
                className="cursor-pointer rounded border border-teal-300/0 p-1 text-teal-600 transition-colors hover:border-teal-300 hover:bg-teal-50 dark:text-teal-400 dark:hover:border-teal-500 dark:hover:bg-teal-900/50"
                title="Save changes"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    actions.onSaveEdit(project.id);
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
              <span className="w-full truncate">{project.name}</span>
              {latest && (
                <span className="w-full text-xs text-black/40 dark:text-white/40">
                  {modelLabel(latest.modelId)} ·{' '}
                  {TRAINING_PROVIDER_SHORT_LABELS[latest.selectedProvider]}
                </span>
              )}
            </div>

            <div className="relative flex items-center">
              <div className="text-sm text-nowrap text-slate-500 tabular-nums transition-transform duration-200 group-hover:-translate-x-8 dark:text-slate-300">
                {project.versions.length === 1
                  ? '1 version'
                  : `${project.versions.length} versions`}
              </div>
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

export const TrainingProjectItem = memo(TrainingProjectItemComponent);
