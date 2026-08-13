import { useEffect } from 'react';

import {
  IoState,
  resetAllModifiedTags,
  resetTags,
  selectAssetById,
  selectHasModifiedAssets,
  selectIoState,
} from '@/app/store/assets';
import { isAssetDirty } from '@/app/store/assets/helpers';
import { useAppDispatch, useAppStore } from '@/app/store/hooks';
import { selectCurrentAssetId } from '@/app/store/selection';

/**
 * Ctrl+D (or Cmd+D) discards the highlighted asset's unsaved changes; with
 * Shift it discards everything — the keyboard twin of the row Discard and
 * Discard All buttons. Active while typing, like the save hotkey: abandoning
 * an edit mid-type is the primary use case. The browser bookmark dialogue is
 * always suppressed on the tagging surface, even when there's nothing to
 * discard.
 */
export const useDiscardHotkey = () => {
  const dispatch = useAppDispatch();
  const store = useAppStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        !(e.ctrlKey || e.metaKey) ||
        e.altKey ||
        e.key.toLowerCase() !== 'd'
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

      if (e.shiftKey) {
        if (!selectHasModifiedAssets(state)) return;
        dispatch(resetAllModifiedTags());
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
      dispatch(resetTags(currentAssetId));
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dispatch, store]);
};
