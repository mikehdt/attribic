'use client';

import { FolderPlusIcon } from 'lucide-react';

import { Button } from '@/app/shared/button';
import { FormTitle } from '@/app/shared/form-title/form-title';
import { Input } from '@/app/shared/input/input';
import { Modal } from '@/app/shared/modal';

import { useNewProjectModal } from './use-new-project-modal';

type NewProjectModalProps = {
  isOpen: boolean;
  onClose: () => void;
  /** The projects root the new folder lands in, shown as a path preview. */
  projectsFolder: string;
  onCreated: (folderName: string) => void;
};

/** Match the separator the configured folder already uses for the preview. */
const joinPath = (folder: string, name: string): string =>
  `${folder}${folder.includes('/') && !folder.includes('\\') ? '/' : '\\'}${name}`;

export const NewProjectModal = ({
  isOpen,
  onClose,
  projectsFolder,
  onCreated,
}: NewProjectModalProps) => {
  const {
    folderName,
    title,
    setTitle,
    handleFolderNameChange,
    nameError,
    serverError,
    isSaving,
    canSubmit,
    handleSubmit,
  } = useNewProjectModal({ isOpen, onClose, onCreated });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="max-w-lg min-w-80"
      preventClose={isSaving}
      labelledById="new-project-modal-title"
    >
      <div className="flex flex-wrap gap-4">
        <h2
          id="new-project-modal-title"
          className="w-full text-2xl font-semibold text-slate-700 dark:text-slate-200"
        >
          New Project
        </h2>

        <p className="w-full text-sm text-slate-500 dark:text-slate-400">
          Creates an empty folder in the projects folder, ready for images.
        </p>

        <div className="flex w-full flex-col gap-1">
          <FormTitle htmlFor="new-project-folder">Folder name</FormTitle>
          <Input
            id="new-project-folder"
            autoFocus
            value={folderName}
            onChange={(e) => handleFolderNameChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. my-project"
            aria-invalid={nameError ? true : undefined}
            aria-describedby="new-project-folder-hint"
          />
          <p
            id="new-project-folder-hint"
            className={`text-sm ${
              nameError
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            {nameError ??
              (folderName.trim()
                ? joinPath(
                    projectsFolder || 'Projects folder',
                    folderName.trim(),
                  )
                : 'Used as the folder on disk, and as the name in the URL.')}
          </p>
        </div>

        <div className="flex w-full flex-col gap-1">
          <FormTitle htmlFor="new-project-title">
            Project name (optional)
          </FormTitle>
          <Input
            id="new-project-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. My Project"
          />
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Shown in place of the folder name. Editable later.
          </p>
        </div>

        {serverError && (
          <p className="w-full text-sm text-rose-600 dark:text-rose-400">
            {serverError}
          </p>
        )}

        <div className="flex w-full justify-end gap-2 pt-2">
          <Button
            onClick={onClose}
            color="slate"
            size="md"
            width="lg"
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            neutralDisabled
            color="sky"
            size="md"
            width="lg"
          >
            <FolderPlusIcon />
            {isSaving ? 'Creating…' : 'Create Project'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
