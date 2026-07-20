import { useCallback, useId, useRef, useState } from 'react';

import { usePopup } from '@/app/shared/popup';
import {
  getProjectDimensionHistogram,
  getProjectFolders,
  getProjectList,
  type Project,
} from '@/app/utils/project-actions';

import type { PickedFolder } from './project-picker';

export function useProjectPicker({
  excludeFolders,
  onSelect,
}: {
  excludeFolders: string[];
  onSelect: (
    folderName: string,
    displayName: string,
    folders: PickedFolder[],
    thumbnail?: boolean,
    thumbnailVersion?: number,
    dimensionHistogram?: Record<string, number>,
  ) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { openPopup, closePopup, getPopupState } = usePopup();
  const popupId = `project-picker-${useId()}`;
  const { isOpen, shouldRender } = getPopupState(popupId);

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectingFolder, setSelectingFolder] = useState<string | null>(null);

  const close = useCallback(() => {
    closePopup(popupId);
  }, [closePopup, popupId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getProjectList();
      // Filter out empty projects
      setProjects(list.filter((p) => (p.imageCount ?? 0) > 0));
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const open = useCallback(async () => {
    // Toggle: if the popup is already open (or mid-open/closing), clicking the
    // trigger should close it rather than re-fetch and flash the loader.
    const state = getPopupState(popupId);
    if (state.isOpen || state.isPositioning || state.shouldRender) {
      close();
      return;
    }

    openPopup(popupId, { position: 'bottom-left', triggerRef });
    refresh();
  }, [openPopup, popupId, getPopupState, close, refresh]);

  const selectProject = useCallback(
    async (project: Project) => {
      if (excludeFolders.includes(project.name)) return;

      setSelectingFolder(project.name);
      try {
        const [details, dimensionHistogram] = await Promise.all([
          getProjectFolders(project.name),
          getProjectDimensionHistogram(project.name),
        ]);
        const folders: PickedFolder[] = details.map((f) => ({
          ...f,
          overrideRepeats: null,
        }));
        onSelect(
          project.name,
          project.title || project.name,
          folders,
          project.thumbnail || undefined,
          project.thumbnailVersion,
          dimensionHistogram,
        );
        close();
      } finally {
        setSelectingFolder(null);
      }
    },
    [excludeFolders, onSelect, close],
  );

  return {
    triggerRef,
    popupId,
    isOpen,
    shouldRender,
    projects,
    loading,
    selectingFolder,
    open,
    close,
    refresh,
    selectProject,
  };
}
