import { useEffect } from 'react';

import {
  IoState,
  saveAllAssets,
  saveAsset,
  selectAssetById,
  selectHasModifiedAssets,
  selectIoState,
} from '@/app/store/assets';
import { isAssetDirty } from '@/app/store/assets/helpers';
import { useAppDispatch, useAppStore } from '@/app/store/hooks';
import { selectProjectFolderName } from '@/app/store/project';
import { selectCurrentAssetId } from '@/app/store/selection';

/**
 * Ctrl+S (or Cmd+S) saves the highlighted asset's changes; with Shift it
 * saves everything — the keyboard twin of the row save and Save All buttons.
 * Deliberately active while typing in inputs: saving mid-edit is the primary
 * use case. The browser save dialogue is always suppressed on the tagging
 * surface, even when there's nothing to save.
 */
export const useSaveHotkey = () => {
  const dispatch = useAppDispatch();
  const store = useAppStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        !(e.ctrlKey || e.metaKey) ||
        e.altKey ||
        e.key.toLowerCase() !== 's'
      ) {
        return;
      }
      e.preventDefault();
      if (e.repeat) return;
      if (document.querySelector('[role="dialog"]')) return;

      const state = store.getState();
      const ioState = selectIoState(state);
      if (
        ioState === IoState.LOADING ||
        ioState === IoState.SAVING ||
        ioState === IoState.COMPLETING
      ) {
        return;
      }
      const projectPath = selectProjectFolderName(state) || undefined;

      if (e.shiftKey) {
        if (!selectHasModifiedAssets(state)) return;
        dispatch(saveAllAssets({ projectPath }));
        return;
      }

      const currentAssetId = selectCurrentAssetId(state);
      if (!currentAssetId) return;
      const asset = selectAssetById(state, currentAssetId);
      if (
        !asset ||
        asset.ioState === IoState.SAVING ||
        !isAssetDirty(asset, state.project.config.captionMode)
      ) {
        return;
      }
      dispatch(saveAsset({ fileId: currentAssetId, projectPath }));
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dispatch, store]);
};
