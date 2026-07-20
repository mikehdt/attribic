'use client';

import { FolderIcon, Loader2Icon, RefreshCwIcon, StarIcon } from 'lucide-react';
import Image from 'next/image';
import React, { memo, useMemo, useState } from 'react';

import { Button } from '@/app/shared/button';
import { Checkbox } from '@/app/shared/checkbox/checkbox';
import { Popup } from '@/app/shared/popup';
import { projectThumbnailSrc } from '@/app/utils/project-thumbnail';

import type {
  DatasetFolder,
  FolderAugmentation,
} from '../training-config-form/use-training-config-form';
import { useProjectPicker } from './use-project-picker';

/** Augmentation is filled in by the reducer — the picker only supplies identity/count/repeats. */
export type PickedFolder = Omit<DatasetFolder, keyof FolderAugmentation>;

type ProjectPickerProps = {
  onSelect: (
    folderName: string,
    displayName: string,
    folders: PickedFolder[],
    thumbnail?: boolean,
    thumbnailVersion?: number,
    dimensionHistogram?: Record<string, number>,
  ) => void;
  excludeFolders: string[];
  children: React.ReactNode;
  buttonSize?: 'sm' | 'md';
  buttonVariant?: 'default' | 'ghost';
};

const ProjectPickerComponent = ({
  onSelect,
  excludeFolders,
  children,
  buttonSize = 'md',
  buttonVariant = 'default',
}: ProjectPickerProps) => {
  const {
    triggerRef,
    popupId,
    projects,
    loading,
    selectingFolder,
    open,
    refresh,
    selectProject,
  } = useProjectPicker({ excludeFolders, onSelect });

  const [showHidden, setShowHidden] = useState(false);

  const { featured, regular, hasHidden } = useMemo(() => {
    const visible = projects.filter((p) => showHidden || !p.hidden);
    return {
      featured: visible.filter((p) => p.featured),
      regular: visible.filter((p) => !p.featured),
      hasHidden: projects.some((p) => p.hidden),
    };
  }, [projects, showHidden]);

  const isEmpty = featured.length === 0 && regular.length === 0;
  // Show the full-panel spinner only on the first load; a manual refresh keeps
  // the list in place and spins the refresh icon instead.
  const showFullSpinner = loading && projects.length === 0;

  const renderProject = (project: (typeof projects)[number]) => {
    const isExcluded = excludeFolders.includes(project.name);
    const isSelecting = selectingFolder === project.name;
    // Dim hidden projects (shown only when Show Hidden is on) to match the
    // main tagging project list, unless already dimmed by another state.
    const isHiddenDimmed = project.hidden && !isExcluded && !isSelecting;
    const thumbnailSrc = project.thumbnail
      ? projectThumbnailSrc(project.name, project.thumbnailVersion)
      : null;

    return (
      <button
        key={project.name}
        type="button"
        disabled={isExcluded || isSelecting}
        onClick={() => selectProject(project)}
        className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-opacity ${
          isExcluded
            ? 'cursor-not-allowed opacity-40'
            : isSelecting
              ? 'bg-sky-50 dark:bg-sky-900/30'
              : 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700'
        } ${isHiddenDimmed ? 'opacity-50 hover:opacity-100' : ''}`}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 dark:bg-slate-600">
          {thumbnailSrc ? (
            <Image
              src={thumbnailSrc}
              alt={project.title || project.name}
              width={32}
              height={32}
              className="h-full w-full object-cover"
            />
          ) : (
            <FolderIcon className="h-4 w-4 text-slate-400" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-(--foreground)">
            {project.title || project.name}
          </div>
          {project.title && project.title !== project.name && (
            <div className="truncate text-xs text-slate-400">
              {project.name}
            </div>
          )}
        </div>

        <span className="shrink-0 text-xs text-slate-400 tabular-nums">
          {isSelecting ? (
            <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
          ) : isExcluded ? (
            'Added'
          ) : (
            `${project.imageCount ?? 0}`
          )}
        </span>
      </button>
    );
  };

  return (
    <>
      <Button
        ref={triggerRef}
        size={buttonSize}
        variant={buttonVariant}
        onClick={open}
        width="lg"
      >
        {children}
      </Button>

      <Popup
        id={popupId}
        position="bottom-left"
        triggerRef={triggerRef}
        className="w-72 rounded-md border border-slate-200 bg-white shadow-md shadow-slate-600/50 dark:border-slate-600 dark:bg-slate-800 dark:shadow-slate-950/50"
      >
        {showFullSpinner ? (
          <div className="flex items-center justify-center py-6">
            <Loader2Icon className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="py-1">
            {/* Toolbar — refresh, plus the show-hidden toggle when there are
                hidden projects. At the top so toggling doesn't shift scroll. */}
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-1.5 dark:border-slate-700">
              {hasHidden ? (
                <Checkbox
                  isSelected={showHidden}
                  onChange={() => setShowHidden(!showHidden)}
                  label="Show hidden projects"
                  size="sm"
                />
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={refresh}
                disabled={loading}
                title="Refresh project list"
                aria-label="Refresh project list"
                className="cursor-pointer rounded p-1 text-slate-400 transition-colors hover:text-slate-600 disabled:cursor-default disabled:opacity-50 dark:hover:text-slate-300"
              >
                <RefreshCwIcon
                  className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
                />
              </button>
            </div>

            {isEmpty && (
              <div className="px-4 py-6 text-center text-sm text-slate-400">
                No projects found
              </div>
            )}

            {/* Featured */}
            {featured.length > 0 && (
              <>
                <div className="flex items-center gap-1.5 px-3 pt-2 pb-1">
                  <StarIcon className="h-3 w-3 fill-current text-amber-500" />
                  <span className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
                    Favourite Projects
                  </span>
                </div>
                {featured.map(renderProject)}
              </>
            )}

            {/* Regular */}
            {regular.length > 0 && (
              <>
                {featured.length > 0 && (
                  <div className="flex items-center gap-1.5 px-3 pt-2 pb-1">
                    <FolderIcon className="h-3 w-3 text-slate-400" />
                    <span className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
                      All Projects
                    </span>
                  </div>
                )}
                {regular.map(renderProject)}
              </>
            )}
          </div>
        )}
      </Popup>
    </>
  );
};

export const ProjectPicker = memo(ProjectPickerComponent);
