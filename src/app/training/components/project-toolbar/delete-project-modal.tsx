'use client';

import { Trash2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { TrainingProjectSummary } from '@/app/services/training-projects/disk-schema';
import { Button } from '@/app/shared/button';
import { Modal } from '@/app/shared/modal';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import { selectLoadedProject } from '@/app/store/training-config';
import {
  deleteProject,
  deleteVersion,
  fetchProjectList,
} from '@/app/store/training-config/thunks';

import { RadioRow } from './radio-row';

type DeleteProjectModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

/** Target identifier: 'project' for whole-project, or the version number. */
type Target = 'project' | number;

export const DeleteProjectModal = ({
  isOpen,
  onClose,
}: DeleteProjectModalProps) => {
  const dispatch = useAppDispatch();
  const loadedProject = useAppSelector(selectLoadedProject);

  const [summary, setSummary] = useState<TrainingProjectSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [target, setTarget] = useState<Target>('project');
  const [confirmed, setConfirmed] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!isOpen || !loadedProject) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional form reset and data fetch on modal open
    setIsLoading(true);
    setTarget('project');
    setConfirmed(false);
    fetchProjectList()
      .then((list) => {
        setSummary(list.find((p) => p.id === loadedProject.id) ?? null);
      })
      .finally(() => setIsLoading(false));
  }, [isOpen, loadedProject]);

  if (!loadedProject) return null;

  const versions = summary?.versions ?? [];
  const onlyOneVersion = versions.length <= 1;

  const handleSubmit = async () => {
    setIsDeleting(true);
    try {
      if (target === 'project') {
        await dispatch(deleteProject(loadedProject.id));
      } else {
        await dispatch(deleteVersion(loadedProject.id, target));
      }
      onClose();
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="max-w-md min-w-[24rem]"
      preventClose={isDeleting}
      labelledById="delete-project-modal-title"
    >
      <div className="flex flex-wrap gap-4">
        <h2
          id="delete-project-modal-title"
          className="w-full text-2xl font-semibold text-slate-700 dark:text-slate-200"
        >
          Delete
        </h2>

        <p className="w-full text-sm text-slate-500">
          Choose what to delete from “{loadedProject.name}”.
        </p>

        {isLoading ? (
          <p className="py-2 text-sm text-slate-400">Loading…</p>
        ) : (
          <div
            className="flex w-full flex-col gap-1"
            role="radiogroup"
            aria-label="Deletion target"
          >
            <RadioRow
              name="delete-target"
              value="project"
              checked={target === 'project'}
              onChange={() => {
                setTarget('project');
                setConfirmed(false);
              }}
            >
              <div className="flex flex-col">
                <span>Whole project</span>
                <span className="text-xs text-slate-500">
                  Deletes all {versions.length}{' '}
                  {versions.length === 1 ? 'version' : 'versions'}
                </span>
              </div>
            </RadioRow>

            {versions
              .slice()
              .reverse()
              .map((v) => (
                <RadioRow
                  key={v.version}
                  name="delete-target"
                  value={String(v.version)}
                  checked={target === v.version}
                  disabled={onlyOneVersion}
                  onChange={() => {
                    setTarget(v.version);
                    setConfirmed(false);
                  }}
                >
                  <div className="flex flex-col">
                    <span>
                      Version v{v.version}
                      {v.label ? ` · ${v.label}` : ''}
                    </span>
                    {onlyOneVersion && (
                      <span className="text-xs text-slate-500">
                        Only version — delete the whole project instead.
                      </span>
                    )}
                  </div>
                </RadioRow>
              ))}
          </div>
        )}

        <label className="flex w-full cursor-pointer items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            {target === 'project'
              ? 'I understand this deletes the project and all its versions.'
              : `I understand v${target} will be permanently deleted.`}
          </span>
        </label>

        <div className="flex w-full justify-end gap-2 pt-2">
          <Button
            type="button"
            onClick={onClose}
            color="slate"
            size="md"
            width="lg"
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!confirmed || isDeleting}
            neutralDisabled
            color="rose"
            size="md"
            width="lg"
          >
            <Trash2Icon className="mr-1 h-4 w-4" />
            {isDeleting ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
