import { FolderIcon, ImageIcon, StarIcon, XIcon } from 'lucide-react';
import Image from 'next/image';
import { memo, useRef, useState } from 'react';

import { projectThumbnailSrc } from '@/app/utils/project-thumbnail';

import type { Project } from './types';

type ProjectIconProps = {
  project: Project;
  isEditing?: boolean;
  onToggleFeatured: (projectName: string, currentFeatured: boolean) => void;
  onThumbnailSelect?: (file: File) => void;
  onThumbnailRemove?: () => void;
};

const ProjectIconComponent = ({
  project,
  isEditing,
  onToggleFeatured,
  onThumbnailSelect,
  onThumbnailRemove,
}: ProjectIconProps) => {
  const [isHovering, setIsHovering] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Build thumbnail src with cache-busting version
  const thumbnailSrc = project.thumbnail
    ? projectThumbnailSrc(project.name, project.thumbnailVersion)
    : null;

  const handleStarClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleFeatured(project.name, project.featured || false);
  };

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onThumbnailSelect) {
      onThumbnailSelect(file);
    }
    // Reset the input so the same file can be selected again
    e.target.value = '';
  };

  const handleRemoveClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onThumbnailRemove?.();
  };

  // Edit mode: show thumbnail selector
  if (isEditing) {
    return (
      <span
        className="relative mr-3 h-10 w-10"
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp"
          onChange={handleFileChange}
          className="hidden"
        />

        {/* Base circle with thumbnail or folder icon */}
        <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-white dark:bg-slate-600">
          {thumbnailSrc ? (
            <Image
              src={thumbnailSrc}
              alt={project.title || project.name}
              width={40}
              height={40}
              className="h-full w-full object-cover"
            />
          ) : (
            <FolderIcon className="h-5 w-5 text-slate-500 dark:text-slate-300" />
          )}
        </span>

        {/* Edit overlay on hover - transitions over the top */}
        <div
          onClick={handleEditClick}
          className={`absolute inset-0 flex cursor-pointer items-center justify-center rounded-full border border-sky-400 bg-sky-100 transition-opacity duration-200 dark:border-sky-500 dark:bg-sky-800 ${isHovering ? 'opacity-100' : 'opacity-0'}`}
          title="Select thumbnail image"
        >
          <ImageIcon className="h-5 w-5 text-sky-600 dark:text-sky-300" />
        </div>

        {/* Remove button - positioned outside overflow-hidden container */}
        {project.thumbnail && isHovering && (
          <div
            onClick={handleRemoveClick}
            className="absolute -top-1 -right-1 flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border border-rose-300 bg-rose-100 transition-colors hover:bg-rose-200 dark:border-rose-500 dark:bg-rose-800 dark:hover:bg-rose-700"
            title="Remove thumbnail"
          >
            <XIcon className="h-3 w-3 text-rose-600 dark:text-rose-300" />
          </div>
        )}
      </span>
    );
  }

  // Normal mode: show star toggle on hover
  return (
    <span
      className="relative mr-3 h-10 w-10"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {/* Base circle with thumbnail or folder icon */}
      <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-white dark:bg-slate-600">
        {thumbnailSrc ? (
          <Image
            src={thumbnailSrc}
            alt={project.title || project.name}
            width={40}
            height={40}
            className="h-full w-full object-cover"
          />
        ) : (
          <FolderIcon className="h-5 w-5 text-slate-500 dark:text-slate-300" />
        )}
      </span>

      {/* Star overlay on hover - transitions over the top */}
      <div
        onClick={handleStarClick}
        className={`absolute inset-0 flex cursor-pointer items-center justify-center rounded-full transition-opacity duration-200 ${isHovering ? 'border opacity-100' : 'opacity-0'} ${project.featured ? 'border-slate-300 bg-white dark:border-slate-500 dark:bg-slate-600' : 'border-amber-400 bg-amber-100 dark:border-amber-500 dark:bg-amber-800'}`}
        title={project.featured ? 'Remove from featured' : 'Add to featured'}
      >
        {project.featured ? (
          <StarIcon className="h-5 w-5 text-slate-600 dark:text-slate-300" />
        ) : (
          <StarIcon className="h-5 w-5 fill-current text-amber-500 dark:text-amber-400" />
        )}
      </div>
    </span>
  );
};

export const ProjectIcon = memo(ProjectIconComponent);
