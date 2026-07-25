'use client';

import { ImagePlusIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { SyntheticEvent } from 'react';

import { Button } from '@/app/shared/button';
import { requestAssetPick } from '@/app/store/asset-import';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import { selectProjectName } from '@/app/store/project';

type NoContentProps = { onReload: () => void };

export const NoContent = ({ onReload }: NoContentProps) => {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const projectName = useAppSelector(selectProjectName);

  const doReload = (e: SyntheticEvent) => {
    e.preventDefault();
    onReload();
  };

  const handleBackToProjects = () => {
    router.push('/');
  };

  // Dropping anywhere on the page is handled by AssetImportHost — this is the
  // visible invitation to do it, and the click route to the file picker.
  const handleAddImages = () => {
    dispatch(requestAssetPick());
  };

  return (
    <div className="mx-auto flex w-full max-w-120 min-w-80 flex-wrap justify-center px-4 py-20 text-center">
      <button
        type="button"
        onClick={handleAddImages}
        className="flex w-full max-w-80 cursor-pointer flex-col items-center gap-3 rounded-2xl border-4 border-dashed border-slate-300 px-6 py-14 text-slate-500 transition-colors hover:border-sky-400 hover:text-sky-600 dark:border-slate-600 dark:text-slate-400 dark:hover:border-sky-500 dark:hover:text-sky-400"
      >
        <ImagePlusIcon className="h-20 w-20" />
        <span className="text-lg font-medium">Drag images here</span>
        <span className="text-sm">or click to choose files</span>
      </button>

      <h1 className="mt-6 mb-4 w-full text-xl text-slate-500">
        No assets found
        {projectName ? ` in ${projectName}` : ''}
      </h1>

      <div className="mt-4 flex w-full justify-center gap-3">
        <Button onClick={doReload} size="md" width="xl">
          Refresh
        </Button>

        <Button onClick={handleBackToProjects} size="md" width="xl">
          Back to Project List
        </Button>
      </div>
    </div>
  );
};
