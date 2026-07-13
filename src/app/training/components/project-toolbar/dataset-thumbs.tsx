'use client';

import { FolderOpenIcon } from 'lucide-react';
import Image from 'next/image';

import type { TrainingProjectDatasetSummary } from '@/app/services/training-projects/disk-schema';

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
  const withThumbs = datasets.filter((d) => d.thumbnail);

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
            src={`/tagging-projects/${d.thumbnail}${d.thumbnailVersion ? `?v=${d.thumbnailVersion}` : ''}`}
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
