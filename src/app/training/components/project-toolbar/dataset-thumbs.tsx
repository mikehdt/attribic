'use client';

import { FolderOpenIcon } from 'lucide-react';
import Image from 'next/image';

import type { TrainingProjectDatasetSummary } from '@/app/services/training-projects/disk-schema';
import { projectThumbnailSrc } from '@/app/utils/project-thumbnail';

/** Thumbs beyond this are dropped — the stack stops reading as a stack. */
const MAX_THUMBS = 3;
/** Vertical offset per thumb below the top one. */
const STEP_PX = 14;

const OPACITIES = [1, 1, 0.5];

/**
 * A training project's dataset thumbnails, cascading down and behind each
 * other so extra datasets read as a stack. Falls back to a folder icon in the
 * same footprint when no dataset has a thumbnail.
 */
export const DatasetThumbs = ({
  datasets,
}: {
  datasets: TrainingProjectDatasetSummary[];
}) => {
  // `folderName` is what the thumbnail URL is built from — `projectName` is a
  // display title the user may have changed. Saves predating it can't resolve
  // a thumbnail, so they fall through to the folder icon.
  const withThumbs = datasets.filter(
    (d): d is TrainingProjectDatasetSummary & { folderName: string } =>
      Boolean(d.thumbnail && d.folderName),
  );

  if (withThumbs.length === 0) {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center self-start">
        <FolderOpenIcon className="h-5 w-5 text-slate-400" />
      </span>
    );
  }

  const shown = withThumbs.slice(0, MAX_THUMBS);

  return (
    <span className="relative h-8 w-8 shrink-0 self-start">
      {shown.map((d, i) => (
        <span
          key={`${d.projectName}-${i}`}
          className="absolute inset-0 overflow-hidden rounded-full ring-1 ring-white dark:ring-slate-800"
          style={{
            transform: `translateY(${i * STEP_PX}px)`,
            opacity: OPACITIES[i],
            zIndex: shown.length - i,
          }}
        >
          <Image
            src={projectThumbnailSrc(d.folderName, d.thumbnailVersion)}
            alt={d.projectName}
            width={32}
            height={32}
            className="h-full w-full object-cover"
          />
        </span>
      ))}
    </span>
  );
};
