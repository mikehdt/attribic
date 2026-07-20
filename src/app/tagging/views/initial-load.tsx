'use client';

import { BoxIcon } from 'lucide-react';
import Image from 'next/image';

import { ProgressBar } from '@/app/shared/progress-bar/progress-bar';
import { selectLoadProgress } from '@/app/store/assets';
import { useAppSelector } from '@/app/store/hooks';
import {
  selectProjectFolderName,
  selectProjectHasThumbnail,
  selectProjectName,
  selectProjectThumbnailVersion,
} from '@/app/store/project';
import { projectThumbnailSrc } from '@/app/utils/project-thumbnail';

export const InitialLoad = () => {
  const loadProgress = useAppSelector(selectLoadProgress);
  const projectName = useAppSelector(selectProjectName);
  const projectFolderName = useAppSelector(selectProjectFolderName);
  const hasThumbnail = useAppSelector(selectProjectHasThumbnail);
  const thumbnailVersion = useAppSelector(selectProjectThumbnailVersion);

  // Build thumbnail src
  const thumbnailSrc =
    hasThumbnail && projectFolderName
      ? projectThumbnailSrc(projectFolderName, thumbnailVersion)
      : null;

  // Calculate progress percentage safely
  const progressPercentage =
    loadProgress && loadProgress.total > 0
      ? Math.round((loadProgress.completed / loadProgress.total) * 100)
      : 0;

  return (
    <div className="mx-auto flex w-full max-w-120 min-w-80 flex-wrap justify-center px-4 py-20 text-center">
      <div className="relative">
        {thumbnailSrc ? (
          <span className="absolute top-0 right-0 bottom-0 left-0 m-auto flex h-21 w-21 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-white">
            <Image
              src={thumbnailSrc}
              alt={projectName || 'Project'}
              width={80}
              height={80}
              priority
              className="h-full w-full object-cover"
            />
          </span>
        ) : null}

        <BoxIcon
          size="100%"
          className="h-full w-full max-w-80 text-slate-500"
        />
      </div>

      <h1 className="mt-4 w-full text-xl text-slate-500">
        Loading{projectName ? ` ${projectName}` : ''}&hellip;
      </h1>

      {loadProgress ? (
        <div className="mt-4 w-full">
          <ProgressBar
            value={loadProgress.completed}
            max={loadProgress.total}
            size="lg"
            color="teal"
          >
            {progressPercentage >= 10 && (
              <span className="pr-2 text-xs font-medium text-white tabular-nums">
                {progressPercentage}%
              </span>
            )}
          </ProgressBar>
          <div className="mt-4 flex items-center justify-center text-xs font-medium text-slate-500 tabular-nums">
            {loadProgress.total > 0 ? (
              <p>
                {loadProgress.completed} / {loadProgress.total}
              </p>
            ) : (
              <p>Preparing&hellip;</p>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-slate-600">Gathering image assets&hellip;</p>
      )}
    </div>
  );
};
