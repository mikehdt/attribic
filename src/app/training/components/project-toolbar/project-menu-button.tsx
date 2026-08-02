'use client';

import {
  ClockIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  FoldersIcon,
} from 'lucide-react';
import { memo, useCallback, useId, useMemo, useRef, useState } from 'react';

import { Button } from '@/app/shared/button';
import { Popup, usePopup } from '@/app/shared/popup';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import {
  resetToSuggestedDefaults,
  selectLoadedProject,
} from '@/app/store/training-config';
import { loadRecentProjects } from '@/app/store/training-config/recent-projects';
import { loadProject } from '@/app/store/training-config/thunks';

import {
  MENU_HEADING_CLASS,
  MENU_ITEM_CLASS,
  MENU_ITEM_DISABLED_CLASS,
} from './menu-styles';
import { ProjectListError } from './project-list-error';
import { useTrainingProjectList } from './use-training-project-list';

/** How many recent projects the menu lists (fewer than are stored). */
const MAX_RECENT_SHOWN = 3;

type ProjectMenuButtonProps = {
  onRequestLoad: () => void;
};

/**
 * Left-edge toolbar button for moving between projects — new, load, recents.
 * Actions on the currently loaded project live in ProjectSelector instead.
 */
const ProjectMenuButtonComponent = ({
  onRequestLoad,
}: ProjectMenuButtonProps) => {
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

  const handleClose = useCallback(() => {
    closePopup(popupId);
  }, [closePopup, popupId]);

  return (
    <div className="relative">
      <Button
        ref={buttonRef}
        onClick={handleToggle}
        variant="toggle"
        size="lg"
        width="lg"
        title="Change project"
        isPressed={isOpen}
        ariaHasPopup="menu"
        ariaExpanded={isOpen}
      >
        <FoldersIcon />
      </Button>

      <Popup
        id={popupId}
        position="bottom-left"
        triggerRef={buttonRef}
        className="min-w-56 rounded-md border border-slate-200 bg-white shadow-lg shadow-slate-600/50 dark:border-slate-600 dark:bg-slate-800 dark:shadow-slate-950/50"
      >
        <PopupContent
          onRequestLoad={() => {
            handleClose();
            onRequestLoad();
          }}
          onClose={handleClose}
        />
      </Popup>
    </div>
  );
};

export const ProjectMenuButton = memo(ProjectMenuButtonComponent);

// ---------------------------------------------------------------------------
// Popup content — hosted inside <Popup>, so it mounts fresh on each open and
// fetches the current project list at that moment.
// ---------------------------------------------------------------------------

type PopupContentProps = {
  onRequestLoad: () => void;
  onClose: () => void;
};

const PopupContent = ({ onRequestLoad, onClose }: PopupContentProps) => {
  const dispatch = useAppDispatch();
  const loadedProject = useAppSelector(selectLoadedProject);
  // Fetch the fresh project list on mount (popup just opened). It backs the
  // recent-projects section.
  const { projects, status, error, reload } = useTrainingProjectList(true);
  const isReady = status === 'ready';
  // Read once: the popup remounts on every open, so this is always current
  // without having to watch localStorage.
  const [recents] = useState(loadRecentProjects);

  /**
   * Recents resolved against what's actually on disk: names come from the
   * fetched list (so a rename can't show stale text), deleted projects drop
   * out, and an entry whose version has since been deleted falls back to the
   * project's latest.
   */
  const recentEntries = useMemo(() => {
    if (!isReady) return [];
    const out: { id: string; name: string; version: number }[] = [];
    for (const entry of recents) {
      // The loaded project already fronts the ProjectSelector next door.
      if (entry.id === loadedProject?.id) continue;
      const project = projects.find((p) => p.id === entry.id);
      if (!project) continue;
      const version = project.versions.some((v) => v.version === entry.version)
        ? entry.version
        : project.latestVersion;
      out.push({ id: project.id, name: project.name, version });
      if (out.length === MAX_RECENT_SHOWN) break;
    }
    return out;
  }, [projects, isReady, recents, loadedProject]);

  const handleNewProject = () => {
    onClose();
    dispatch(resetToSuggestedDefaults());
  };

  const handleOpenRecent = (id: string, version: number) => {
    onClose();
    void dispatch(loadProject(id, version));
  };

  return (
    <div className="flex flex-col divide-y divide-slate-100 dark:divide-slate-700">
      {status === 'error' && (
        <div className="p-2">
          <ProjectListError error={error} onRetry={reload} />
        </div>
      )}

      <div className="flex flex-col">
        {/* With nothing loaded the form already is a new project. */}
        <button
          type="button"
          onClick={handleNewProject}
          disabled={!loadedProject}
          title={loadedProject ? undefined : 'Already on a new project'}
          className={loadedProject ? MENU_ITEM_CLASS : MENU_ITEM_DISABLED_CLASS}
        >
          <FolderPlusIcon className="h-4 w-4" />
          New Project
        </button>

        <button
          type="button"
          onClick={onRequestLoad}
          className={MENU_ITEM_CLASS}
        >
          <FolderOpenIcon className="h-4 w-4" />
          {loadedProject ? 'Load other project…' : 'Load project…'}
        </button>
      </div>

      {recentEntries.length > 0 && (
        <div className="flex flex-col py-1">
          <p className={MENU_HEADING_CLASS}>Recent Projects</p>
          {recentEntries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => handleOpenRecent(entry.id, entry.version)}
              className={MENU_ITEM_CLASS}
            >
              <ClockIcon className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="truncate">{entry.name}</span>
              <span className="ml-auto shrink-0 text-slate-400 tabular-nums">
                v{entry.version}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
