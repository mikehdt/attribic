'use client';

/**
 * Shared state for the two Auto Tagger entry points — the tag-mode overflow
 * menu item and the caption-mode toolbar button. Both need the same things:
 * the model inventory loaded, whether a run is possible at all, the asset list
 * to hand the modal, and open/close plumbing.
 *
 * Both entry points are always mounted, so neither may subscribe to the full
 * asset arrays while its modal is closed — the arrays are only read once the
 * modal opens, and enablement runs off counts and booleans.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { ImageAsset } from '@/app/store/assets';
import { selectFilteredAssets } from '@/app/store/assets';
import {
  fetchAutoTaggerModels,
  selectHasReadyModel,
} from '@/app/store/auto-tagger';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import { selectWorkingSelectionCount } from '@/app/store/selection';
import {
  selectAssetsWithActiveFiltersCount,
  selectWorkingSelectionData,
} from '@/app/store/selection/combinedSelectors';

/** Stable sentinel returned while the modal is closed. */
const NO_ASSETS: ImageAsset[] = [];

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

  const selectedAssetsData = useAppSelector((state) =>
    isModalOpen ? selectWorkingSelectionData(state) : NO_ASSETS,
  );
  const filteredAssets = useAppSelector((state) =>
    isModalOpen ? selectFilteredAssets(state) : NO_ASSETS,
  );
  const selectedAssetsCount = useAppSelector(selectWorkingSelectionCount);
  const filteredAssetsCount = useAppSelector(
    selectAssetsWithActiveFiltersCount,
  );
  const hasReadyModel = useAppSelector(selectHasReadyModel);

  // Videos are included — the ONNX batch route extracts a poster frame per
  // video, and VLM models that support video sample it directly.
  const assetsForTagger = useMemo(() => {
    if (!isModalOpen) return [];
    const source =
      selectedAssetsData.length > 0 ? selectedAssetsData : filteredAssets;
    return source.map((asset) => ({
      fileId: asset.fileId,
      fileExtension: asset.fileExtension,
    }));
  }, [isModalOpen, selectedAssetsData, filteredAssets]);

  const openModal = useCallback(() => setIsModalOpen(true), []);
  const closeModal = useCallback(() => setIsModalOpen(false), []);

  return {
    isModalOpen,
    openModal,
    closeModal,
    assetsForTagger,
    hasReadyModel,
    selectedAssetsCount,
    filteredAssetsCount,
    /** Enablement for the trigger: a ready model and something to run it on. */
    canRun:
      hasReadyModel && (selectedAssetsCount > 0 || filteredAssetsCount > 0),
  };
}
