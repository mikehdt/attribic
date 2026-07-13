'use client';

import {
  ChevronDownIcon,
  CircleIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  PencilIcon,
  SaveIcon,
  Trash2Icon,
} from 'lucide-react';
import { memo, useCallback, useEffect, useId, useRef, useState } from 'react';

import type { TrainingProjectSummary } from '@/app/services/training-projects/disk-schema';
import { Button } from '@/app/shared/button';
import { Input } from '@/app/shared/input/input';
import { Popup, usePopup } from '@/app/shared/popup';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import {
  resetToSuggestedDefaults,
  selectIsDirty,
  selectLoadedProject,
} from '@/app/store/training-config';
import {
  fetchProjectList,
  loadProject,
  renameProject,
  setVersionLabel,
} from '@/app/store/training-config/thunks';
import type { LoadedProject } from '@/app/store/training-config/types';

import { ModelBackendBadges } from './model-backend-badges';

type ProjectSelectorProps = {
  onRequestLoad: () => void;
  onRequestSaveAs: () => void;
  onRequestDelete: () => void;
};

const ProjectSelectorComponent = ({
  onRequestLoad,
  onRequestSaveAs,
  onRequestDelete,
}: ProjectSelectorProps) => {
  const loadedProject = useAppSelector(selectLoadedProject);
  const isDirty = useAppSelector(selectIsDirty);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const { openPopup, closePopup, getPopupState } = usePopup();
  const popupId = useId();
  const isOpen = getPopupState(popupId).isOpen;

  const handleToggle = useCallback(() => {
    if (isOpen) {
      closePopup(popupId);
    } else {
      openPopup(popupId, {
        position: 'bottom-left',
        triggerRef: buttonRef,
      });
    }
  }, [isOpen, openPopup, closePopup, popupId]);

  const triggerLabel = loadedProject ? (
    <span className="flex items-center gap-1.5">
      <FolderOpenIcon className="h-3.5 w-3.5 text-slate-400" />
      <span className="font-medium">{loadedProject.name}</span>
      <span className="text-slate-400">
        · v{loadedProject.version}
        {loadedProject.versionLabel ? ` · ${loadedProject.versionLabel}` : ''}
      </span>
      {isDirty && (
        <CircleIcon
          className="h-2 w-2 fill-amber-500 text-amber-500"
          aria-label="Unsaved changes"
        />
      )}
    </span>
  ) : (
    <span className="flex items-center gap-1.5 text-slate-500">
      <FolderOpenIcon className="h-3.5 w-3.5 text-slate-400" />
      <span>Unsaved</span>
    </span>
  );

  const handleClose = useCallback(() => {
    closePopup(popupId);
  }, [closePopup, popupId]);

  return (
    <div className="relative">
      <Button
        ref={buttonRef}
        size="sm"
        variant="ghost"
        onClick={handleToggle}
        isPressed={isOpen}
      >
        {triggerLabel}
        <ChevronDownIcon
          className={`ml-1 h-3 w-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </Button>

      <Popup
        id={popupId}
        position="bottom-left"
        triggerRef={buttonRef}
        className="min-w-72 rounded-md border border-slate-200 bg-white shadow-lg shadow-slate-600/50 dark:border-slate-600 dark:bg-slate-800 dark:shadow-slate-950/50"
      >
        <PopupContent
          loadedProject={loadedProject}
          onRequestLoad={() => {
            handleClose();
            onRequestLoad();
          }}
          onRequestSaveAs={() => {
            handleClose();
            onRequestSaveAs();
          }}
          onRequestDelete={() => {
            handleClose();
            onRequestDelete();
          }}
          onClose={handleClose}
        />
      </Popup>
    </div>
  );
};

export const ProjectSelector = memo(ProjectSelectorComponent);

// ---------------------------------------------------------------------------
// Popup content — hosted inside <Popup>. Popup only renders its children
// while open, so this subcomponent mounts fresh on each open. That resets
// the inline rename/label-edit state without needing cleanup effects.
// ---------------------------------------------------------------------------

type PopupContentProps = {
  loadedProject: LoadedProject | null;
  onRequestLoad: () => void;
  onRequestSaveAs: () => void;
  onRequestDelete: () => void;
  onClose: () => void;
};

const PopupContent = ({
  loadedProject,
  onRequestLoad,
  onRequestSaveAs,
  onRequestDelete,
  onClose,
}: PopupContentProps) => {
  const dispatch = useAppDispatch();
  const [summary, setSummary] = useState<TrainingProjectSummary | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [labelEditVersion, setLabelEditVersion] = useState<number | null>(null);
  const [labelValue, setLabelValue] = useState('');

  // Fetch fresh version list on mount (popup just opened).
  useEffect(() => {
    if (!loadedProject) return;
    let cancelled = false;
    fetchProjectList().then((list) => {
      if (cancelled) return;
      setSummary(list.find((p) => p.id === loadedProject.id) ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [loadedProject]);

  const handleGoEphemeral = () => {
    onClose();
    dispatch(resetToSuggestedDefaults());
  };

  const handleSwitchVersion = (version: number) => {
    if (!loadedProject) return;
    onClose();
    void dispatch(loadProject(loadedProject.id, version));
  };

  const startRename = () => {
    if (!loadedProject) return;
    setRenameValue(loadedProject.name);
    setIsRenaming(true);
  };

  const commitRename = () => {
    if (!loadedProject) return;
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== loadedProject.name) {
      void dispatch(renameProject(loadedProject.id, trimmed));
    }
    setIsRenaming(false);
  };

  const startLabelEdit = (version: number, currentLabel: string | null) => {
    setLabelEditVersion(version);
    setLabelValue(currentLabel ?? '');
  };

  const commitLabelEdit = () => {
    if (!loadedProject || labelEditVersion === null) return;
    const next = labelValue.trim() || null;
    void dispatch(setVersionLabel(loadedProject.id, labelEditVersion, next));
    setLabelEditVersion(null);
  };

  return (
    <div className="flex flex-col divide-y divide-slate-100 dark:divide-slate-700">
      {loadedProject && (
        <>
          <div className="p-2">
            {isRenaming ? (
              <div className="flex gap-1">
                <Input
                  size="sm"
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setIsRenaming(false);
                  }}
                  className="flex-1"
                />
                <Button size="sm" onClick={commitRename}>
                  Save
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 px-1">
                <span className="truncate font-medium text-slate-700 dark:text-slate-200">
                  {loadedProject.name}
                </span>
                <button
                  type="button"
                  onClick={startRename}
                  className="cursor-pointer rounded-sm p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                  aria-label="Rename project"
                >
                  <PencilIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>

          <div className="flex max-h-80 flex-col overflow-auto p-1">
            {summary?.versions
              .slice()
              .reverse()
              .map((v) => {
                const isActive = loadedProject.version === v.version;
                const isEditing = labelEditVersion === v.version;
                return (
                  <div
                    key={v.version}
                    className={`flex items-center gap-1 rounded-md px-2 py-1 transition-colors ${
                      isActive
                        ? 'bg-sky-50 text-sky-800 dark:bg-sky-900/30 dark:text-sky-200'
                        : 'hover:bg-slate-100 dark:hover:bg-slate-700/50'
                    }`}
                  >
                    {isEditing ? (
                      <>
                        <span className="text-sm text-slate-500 tabular-nums">
                          v{v.version}
                        </span>
                        <Input
                          size="sm"
                          autoFocus
                          placeholder="label"
                          value={labelValue}
                          onChange={(e) => setLabelValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitLabelEdit();
                            if (e.key === 'Escape') setLabelEditVersion(null);
                          }}
                          className="flex-1"
                        />
                        <Button size="sm" onClick={commitLabelEdit}>
                          Set
                        </Button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => handleSwitchVersion(v.version)}
                          className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 text-left"
                        >
                          {/* With a label the badges drop to their own line;
                              without one they sit beside the version number. */}
                          <span className="flex items-center gap-2">
                            <span className="text-sm font-medium tabular-nums">
                              v{v.version}
                            </span>
                            {v.label ? (
                              <span className="truncate text-xs text-slate-500">
                                {v.label}
                              </span>
                            ) : (
                              <ModelBackendBadges version={v} />
                            )}
                          </span>
                          {v.label && <ModelBackendBadges version={v} />}
                        </button>
                        <button
                          type="button"
                          onClick={() => startLabelEdit(v.version, v.label)}
                          className="cursor-pointer rounded-sm p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-600 dark:hover:text-slate-200"
                          aria-label={`Edit label for v${v.version}`}
                        >
                          <PencilIcon className="h-3 w-3" />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            {summary && summary.versions.length === 0 && (
              <p className="px-2 py-1 text-xs text-slate-400">
                No versions yet.
              </p>
            )}
          </div>
        </>
      )}

      <div className="flex flex-col">
        <button
          type="button"
          onClick={onRequestSaveAs}
          className="flex cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          <SaveIcon className="h-4 w-4" />
          Save As…
        </button>
        <button
          type="button"
          onClick={onRequestLoad}
          className="flex cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          <FolderOpenIcon className="h-4 w-4" />
          {loadedProject ? 'Load other project…' : 'Load project…'}
        </button>
        {loadedProject && (
          <>
            <button
              type="button"
              onClick={onRequestDelete}
              className="flex cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              <Trash2Icon className="h-4 w-4" />
              Delete project or version…
            </button>
            <button
              type="button"
              onClick={handleGoEphemeral}
              className="flex cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              <FolderPlusIcon className="h-4 w-4" />
              New Project
            </button>
          </>
        )}
      </div>
    </div>
  );
};
