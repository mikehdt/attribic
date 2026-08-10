'use client';

import { FolderOpenIcon, PencilIcon } from 'lucide-react';
import { useCallback, useState } from 'react';

import { Button } from '@/app/shared/button';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import {
  requestProjectListRefresh,
  selectProjectsFolder,
  setProjectsFolder,
} from '@/app/store/project-list';

/**
 * Persist a newly picked projects folder, then ask the page to refetch both
 * project lists — the training root lives inside the projects folder, so a
 * folder change invalidates the training list too.
 */
const useSaveProjectsFolder = () => {
  const dispatch = useAppDispatch();

  return useCallback(
    async (folder: string): Promise<{ error?: string }> => {
      try {
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectsFolder: folder }),
        });

        const data = await res.json();

        if (!res.ok) {
          return { error: data.error || 'Failed to save' };
        }

        dispatch(setProjectsFolder(folder));
        dispatch(requestProjectListRefresh());
        return {};
      } catch {
        return { error: 'Failed to save projects folder' };
      }
    },
    [dispatch],
  );
};

/** Browse for a folder and persist it as the projects folder. */
const useFolderBrowse = () => {
  const save = useSaveProjectsFolder();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const browse = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({
        title: 'Select projects folder',
        mode: 'folder',
      });
      const res = await fetch(`/api/filesystem/browse?${params}`);
      const data = await res.json();

      if (data.cancelled || !data.path) return;

      setSaving(true);
      const result = await save(data.path);
      setSaving(false);

      if (result.error) {
        setError(result.error);
      }
    } catch {
      setSaving(false);
      setError('Failed to open folder picker');
    }
  }, [save]);

  return { browse, saving, error };
};

// Compact button shown in the top shelf — opens the folder picker.
export const ProjectsFolderButton = () => {
  const folder = useAppSelector(selectProjectsFolder);
  const { browse, saving, error } = useFolderBrowse();

  return (
    <div className="flex flex-wrap">
      <Button
        onClick={browse}
        disabled={saving}
        size="xs"
        width="md"
        variant="ghost"
        title="Set the projects folder"
      >
        <FolderOpenIcon />
        <span className="max-w-40 truncate">
          {saving ? 'Saving…' : `${folder || 'Not configured'}`}
        </span>
        <PencilIcon className="ml-1" />
      </Button>

      {error && (
        <p className="w-full text-center text-xs text-rose-500 dark:text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
};

// Inline folder picker for empty/error states
export const ProjectsFolderInline = () => {
  const folder = useAppSelector(selectProjectsFolder);
  const { browse, saving, error } = useFolderBrowse();

  return (
    <div className="mt-4 flex flex-col justify-center">
      <h2 className="mb-2 font-medium">Projects Folder</h2>

      <Button
        onClick={browse}
        disabled={saving}
        variant="ghost"
        size="md"
        width="lg"
      >
        <FolderOpenIcon />

        <span className="max-w-64 truncate">
          {saving ? 'Saving…' : folder || 'No folder configured'}
        </span>

        <PencilIcon className="ml-2" />
      </Button>

      {error && (
        <p className="mt-2 text-xs text-rose-500 dark:text-rose-400">{error}</p>
      )}
    </div>
  );
};
