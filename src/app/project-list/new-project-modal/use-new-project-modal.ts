import { useCallback, useEffect, useMemo, useState } from 'react';

import { createProject } from '@/app/utils/project-actions';
import { validateProjectFolderName } from '@/app/utils/project-folder-name';

type UseNewProjectModalArgs = {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the new folder name once the project exists on disk. */
  onCreated: (folderName: string) => void;
};

export const useNewProjectModal = ({
  isOpen,
  onClose,
  onCreated,
}: UseNewProjectModalArgs) => {
  const [folderName, setFolderName] = useState('');
  const [title, setTitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Reset on open so a cancelled attempt doesn't come back pre-filled.
  useEffect(() => {
    if (!isOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional form reset on modal open
    setFolderName('');
    setTitle('');
    setIsSaving(false);
    setServerError(null);
  }, [isOpen]);

  // Held back until something has been typed: an empty field on open is the
  // starting state, not a mistake to flag.
  const nameError = useMemo(
    () => (folderName.trim() ? validateProjectFolderName(folderName) : null),
    [folderName],
  );

  const canSubmit = !isSaving && folderName.trim().length > 0 && !nameError;

  const handleFolderNameChange = useCallback((value: string) => {
    setFolderName(value);
    // The stale message would otherwise sit under a name the user has since
    // changed, reading as though the new one is taken too.
    setServerError(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;

    setIsSaving(true);
    setServerError(null);

    try {
      const result = await createProject(folderName, title);

      if (!result.success) {
        setServerError(result.error);
        return;
      }

      onCreated(result.project.name);
      onClose();
    } catch (error) {
      console.error('Error creating project:', error);
      setServerError('Could not create the project.');
    } finally {
      setIsSaving(false);
    }
  }, [canSubmit, folderName, title, onCreated, onClose]);

  return {
    folderName,
    title,
    setTitle,
    handleFolderNameChange,
    nameError,
    serverError,
    isSaving,
    canSubmit,
    handleSubmit,
  };
};
