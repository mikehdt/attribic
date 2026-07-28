'use client';

import { TriangleAlertIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@/app/shared/button';
import { selectIoMessage, selectLoadProgress } from '@/app/store/assets';
import { useAppSelector } from '@/app/store/hooks';
import { selectProjectName } from '@/app/store/project';

type ErrorViewProps = {
  onReload: (_args?: { maintainIoState: boolean }) => void;
};

export const ErrorView = ({ onReload }: ErrorViewProps) => {
  const router = useRouter();

  const handleRetry = () => {
    onReload({ maintainIoState: true });
  };

  const handleBackToProjects = () => {
    // Just navigate back - project list will handle clearing state
    router.push('/');
  };

  const errorMessage = useAppSelector(selectIoMessage);
  const loadProgress = useAppSelector(selectLoadProgress);
  const projectName = useAppSelector(selectProjectName);

  return (
    <div className="mx-auto flex w-full max-w-120 min-w-80 flex-wrap justify-center px-4 py-20 text-center">
      <TriangleAlertIcon className="w-full max-w-80 text-slate-500" />

      <h1 className="mt-4 mb-4 w-full text-xl text-slate-500">
        An I/O error occurred{projectName ? ` loading ${projectName}` : ''}
      </h1>

      <div className="mt-4 flex w-full justify-center gap-3">
        <Button onClick={handleRetry} size="md" width="xl">
          Retry
        </Button>
        <Button
          onClick={handleBackToProjects}
          size="md"
          width="xl"
          variant="ghost"
        >
          Back to Projects
        </Button>
      </div>

      {errorMessage ? (
        <p className="mt-4 w-full text-rose-500">{String(errorMessage)}</p>
      ) : null}

      {loadProgress ? (
        <p className="mt-4 w-full text-xs text-slate-500 tabular-nums">
          {loadProgress.completed} / {loadProgress.total}
        </p>
      ) : null}
    </div>
  );
};
