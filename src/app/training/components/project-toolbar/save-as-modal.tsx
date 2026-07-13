'use client';

import { FolderPlusIcon, SaveIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { TrainingProjectSummary } from '@/app/services/training-projects/disk-schema';
import { Button } from '@/app/shared/button';
import { FormTitle } from '@/app/shared/form-title/form-title';
import { Input } from '@/app/shared/input/input';
import { Modal } from '@/app/shared/modal';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import { selectForm, selectLoadedProject } from '@/app/store/training-config';
import {
  fetchProjectList,
  replaceExistingProject,
  saveAsNewProject,
  saveAsNewVersion,
} from '@/app/store/training-config/thunks';

import { RadioRow } from './radio-row';

type SaveAsModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

const NEW_PROJECT = '__new__';
type TargetMode = 'newVersion' | 'replace';

function formatRelative(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export const SaveAsModal = ({ isOpen, onClose }: SaveAsModalProps) => {
  const dispatch = useAppDispatch();
  const form = useAppSelector(selectForm);
  const loadedProject = useAppSelector(selectLoadedProject);

  const [projects, setProjects] = useState<TrainingProjectSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selected, setSelected] = useState<string>(NEW_PROJECT);
  const [targetMode, setTargetMode] = useState<TargetMode>('newVersion');
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);

  // Load the project list whenever the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional form reset and data fetch on modal open
    setIsLoading(true);
    fetchProjectList()
      .then((list) => {
        setProjects(list);
        // With a project loaded, the common intent is another version of it —
        // preselect it. Guard against a project deleted since it was loaded.
        setSelected(
          loadedProject && list.some((p) => p.id === loadedProject.id)
            ? loadedProject.id
            : NEW_PROJECT,
        );
      })
      .finally(() => setIsLoading(false));

    // Reset form state on open
    setSelected(loadedProject?.id ?? NEW_PROJECT);
    setTargetMode('newVersion');
    setName('');
    setLabel('');
    setConfirmReplace(false);
  }, [isOpen, loadedProject]);

  const isNew = selected === NEW_PROJECT;
  const selectedProject = useMemo(
    () => (isNew ? null : (projects.find((p) => p.id === selected) ?? null)),
    [isNew, projects, selected],
  );

  // The loaded project leads the list — it's the preselected destination, so it
  // shouldn't start scrolled out of view.
  const orderedProjects = useMemo(() => {
    if (!loadedProject) return projects;
    const current = projects.find((p) => p.id === loadedProject.id);
    if (!current) return projects;
    return [current, ...projects.filter((p) => p.id !== current.id)];
  }, [loadedProject, projects]);

  const nameTaken = useMemo(
    () =>
      isNew &&
      name.trim().length > 0 &&
      projects.some((p) => p.name.toLowerCase() === name.trim().toLowerCase()),
    [isNew, name, projects],
  );

  const canSubmit = (() => {
    if (isSaving) return false;
    if (isNew) return name.trim().length > 0 && !nameTaken;
    if (!selectedProject) return false;
    if (targetMode === 'replace') return confirmReplace;
    return true;
  })();

  const handleSubmit = async () => {
    setIsSaving(true);
    try {
      if (isNew) {
        await dispatch(
          saveAsNewProject(name.trim(), form, label.trim() || null),
        );
      } else if (selectedProject) {
        if (targetMode === 'newVersion') {
          await dispatch(
            saveAsNewVersion(selectedProject.id, form, label.trim() || null),
          );
        } else {
          await dispatch(
            replaceExistingProject(selectedProject.id, form, {
              label: label.trim() || null,
            }),
          );
        }
      }
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="max-w-lg min-w-[28rem]"
      preventClose={isSaving}
    >
      <div className="flex flex-wrap gap-4">
        <h2 className="w-full text-2xl font-semibold text-slate-700 dark:text-slate-200">
          Save As
        </h2>

        <p className="w-full text-sm text-slate-500">
          {loadedProject
            ? `Save the current settings as a new version of “${loadedProject.name}”, another project, or a brand new one.`
            : 'Save the current settings as a new project or a new version of an existing project.'}
        </p>

        <div className="w-full">
          <p className="mb-2 text-sm font-medium text-slate-600 dark:text-slate-300">
            Destination
          </p>

          {isLoading ? (
            <p className="py-2 text-sm text-slate-400">Loading projects…</p>
          ) : (
            <div
              className="flex max-h-64 flex-col gap-1 overflow-auto"
              role="radiogroup"
              aria-label="Save destination"
            >
              {orderedProjects.map((p) => (
                <RadioRow
                  key={p.id}
                  name="save-as-destination"
                  value={p.id}
                  checked={selected === p.id}
                  onChange={() => setSelected(p.id)}
                >
                  <span className="truncate">{p.name}</span>
                  {p.id === loadedProject?.id && (
                    <span className="shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-600 dark:text-slate-300">
                      Open
                    </span>
                  )}
                  <span className="flex-1" />
                  <span className="text-xs text-slate-400 tabular-nums">
                    v{p.latestVersion} · {formatRelative(p.updatedAt)}
                  </span>
                </RadioRow>
              ))}

              <RadioRow
                name="save-as-destination"
                value={NEW_PROJECT}
                checked={isNew}
                onChange={() => setSelected(NEW_PROJECT)}
              >
                <FolderPlusIcon className="h-4 w-4 shrink-0 text-slate-400" />
                <span className="flex-1">New project</span>
              </RadioRow>
            </div>
          )}
        </div>

        {/* New-project form */}
        {isNew && (
          <div className="flex w-full flex-col gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-600 dark:bg-slate-800">
            <div className="flex flex-col gap-1">
              <FormTitle htmlFor="new-project-name">Project name</FormTitle>
              <Input
                id="new-project-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. arcadia style"
              />
              {nameTaken && (
                <p className="text-xs text-rose-600">
                  A project with that name already exists.
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <FormTitle htmlFor="new-project-label">
                Version label (optional)
              </FormTitle>
              <Input
                id="new-project-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. first pass"
              />
            </div>
          </div>
        )}

        {/* Existing-project secondary choice */}
        {!isNew && selectedProject && (
          <div className="flex w-full flex-col gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-600 dark:bg-slate-800">
            <div
              className="flex flex-col gap-1"
              role="radiogroup"
              aria-label="Target mode"
            >
              <RadioRow
                name="save-as-mode"
                value="newVersion"
                checked={targetMode === 'newVersion'}
                onChange={() => setTargetMode('newVersion')}
              >
                <div className="flex flex-col">
                  <span>
                    Add as v{selectedProject.latestVersion + 1} of “
                    {selectedProject.name}”
                  </span>
                  <span className="text-xs text-slate-500">
                    Keeps all previous versions.
                  </span>
                </div>
              </RadioRow>
              <RadioRow
                name="save-as-mode"
                value="replace"
                checked={targetMode === 'replace'}
                onChange={() => setTargetMode('replace')}
              >
                <div className="flex flex-col">
                  <span>Replace “{selectedProject.name}”</span>
                  <span className="text-xs text-slate-500">
                    Deletes all existing versions and starts fresh at v1.
                  </span>
                </div>
              </RadioRow>
            </div>

            <div className="flex flex-col gap-1">
              <FormTitle htmlFor="existing-label">
                Version label (optional)
              </FormTitle>
              <Input
                id="existing-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. bumped LR"
              />
            </div>

            {targetMode === 'replace' && (
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
                <input
                  type="checkbox"
                  checked={confirmReplace}
                  onChange={(e) => setConfirmReplace(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  I understand the {selectedProject.versions.length} existing{' '}
                  {selectedProject.versions.length === 1
                    ? 'version'
                    : 'versions'}{' '}
                  of this project will be deleted.
                </span>
              </label>
            )}
          </div>
        )}

        <div className="flex w-full justify-end gap-2 pt-2">
          <Button
            type="button"
            onClick={onClose}
            color="slate"
            size="md"
            width="lg"
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            neutralDisabled
            color="sky"
            size="md"
            width="lg"
          >
            <SaveIcon className="mr-1 h-4 w-4" />
            {isSaving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
