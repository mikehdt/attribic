'use client';

/**
 * Shared state for the two Auto Tagger entry points — the tag-mode overflow
 * menu item and the caption-mode toolbar button. Both need the same things:
 * the model inventory loaded, whether a run is possible at all, and open/close
 * plumbing. The asset list itself is the modal's business now — it owns the
 * scope choice (all / filtered / selected) — so enablement here runs off
 * counts and booleans only, which matters because both entry points are
 * always mounted.
 */

import { useCallback, useEffect, useState } from 'react';

import {
  fetchAutoTaggerModels,
  selectHasReadyModel,
} from '@/app/store/auto-tagger';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import { selectWorkingSelectionCount } from '@/app/store/selection';
import { selectAssetsWithActiveFiltersCount } from '@/app/store/selection/combinedSelectors';

export function useAutoTaggerLaunch() {
  const dispatch = useAppDispatch();

  // Never auto-opens: a batch running for this project (one the user started
  // elsewhere, or one reattached to on return) shows in the activity panel,
  // which is where its progress lives now.
  const [isModalOpen, setIsModalOpen] = useState(false);

  // The thunk's `condition` drops repeat and concurrent dispatches, so both
  // entry points can ask on mount without coordinating, and a failed fetch is
  // retried by the next mount.
  useEffect(() => {
    dispatch(fetchAutoTaggerModels());
  }, [dispatch]);

  const selectedAssetsCount = useAppSelector(selectWorkingSelectionCount);
  const filteredAssetsCount = useAppSelector(
    selectAssetsWithActiveFiltersCount,
  );
  const hasAssets = useAppSelector((state) => state.assets.images.length > 0);
  const hasReadyModel = useAppSelector(selectHasReadyModel);

  const openModal = useCallback(() => setIsModalOpen(true), []);
  const closeModal = useCallback(() => setIsModalOpen(false), []);

  return {
    isModalOpen,
    openModal,
    closeModal,
    hasReadyModel,
    selectedAssetsCount,
    filteredAssetsCount,
    /** Enablement for the trigger: a ready model and something to run it on. */
    canRun: hasReadyModel && hasAssets,
  };
}
