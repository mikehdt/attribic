'use client';

import { useMemo, useState } from 'react';

import type { ImageAsset } from '@/app/store/assets';
import {
  selectHasActiveFilters,
  selectHasActiveNonArchiveVisibility,
} from '@/app/store/filters';
import { useAppSelector } from '@/app/store/hooks';
import {
  selectSelectedAssetsCount,
  selectWorkingSelection,
  selectWorkingSelectionCount,
} from '@/app/store/selection';
import {
  selectAssetsWithActiveFilters,
  selectBulkEditableAssets,
} from '@/app/store/selection/combinedSelectors';

/** Stable sentinels returned while the modal is closed. */
const NO_ASSETS: ImageAsset[] = [];
const NO_IDS: string[] = [];

export type TaggerScope = ReturnType<typeof useTaggerScope>;

/**
 * Which assets a batch runs over — all assets by default, optionally narrowed
 * to the filtered and/or selected sets. Owned by the modal rather than its
 * launcher so the choice is made (and visible) alongside the run's settings.
 *
 * "Filtered" deliberately means `selectAssetsWithActiveFilters` — the union of
 * the user's filter chips (plus visibility scopes), the same answer every bulk
 * action gives to "which assets did the user mean?". NOT `selectFilteredAssets`:
 * that's the *view*, and it only narrows once a chip's class mode is applied —
 * with the mode off, a picked tag would count the whole project as "filtered".
 * Likewise "all" is the bulk-editable pool, so a hidden archive is left alone.
 */
export function useTaggerScope(isOpen: boolean) {
  // The full asset arrays are only read while the modal is open — the modal is
  // always mounted, and these subscriptions would otherwise re-render it on
  // every tag edit. Counts and booleans are cheap and stay live.
  const allAssets = useAppSelector((state) =>
    isOpen ? selectBulkEditableAssets(state) : NO_ASSETS,
  );
  const filteredAssets = useAppSelector((state) =>
    isOpen ? selectAssetsWithActiveFilters(state) : NO_ASSETS,
  );
  const selectedIds = useAppSelector((state) =>
    isOpen ? selectWorkingSelection(state) : NO_IDS,
  );
  // Chips and visibility scopes (Tagless, Modified, …) both count as active
  // filtering — selectAssetsWithActiveFilters resolves either kind.
  const hasChipFilters = useAppSelector(selectHasActiveFilters);
  const hasVisibilityScopes = useAppSelector(
    selectHasActiveNonArchiveVisibility,
  );
  const hasActiveFilters = hasChipFilters || hasVisibilityScopes;
  const selectedAssetsCount = useAppSelector(selectWorkingSelectionCount);
  const hasSelectedAssets = selectedAssetsCount > 0;
  // Ticks alone seed the scope checkbox — see the initialisation below.
  const hasTickedAssets = useAppSelector(selectSelectedAssetsCount) > 0;

  const [onlyFilteredAssets, setOnlyFilteredAssets] = useState(false);
  const [onlySelectedAssets, setOnlySelectedAssets] = useState(false);

  // Seed scoping on the closed→open transition, same rules as Search &
  // Replace: active filtering ticks the filtered scope, and only *ticked*
  // assets tick the selected scope — a stray highlight (nearly always present
  // after clicking around) must not quietly shrink a whole-project run to one
  // asset.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setOnlyFilteredAssets(hasActiveFilters);
      setOnlySelectedAssets(hasTickedAssets);
    }
  }

  const scopedAssets = useMemo(() => {
    const useFiltered = onlyFilteredAssets && hasActiveFilters;
    const useSelected = onlySelectedAssets && hasSelectedAssets;

    const base = useFiltered ? filteredAssets : allAssets;
    const selectedIdSet = useSelected ? new Set(selectedIds) : null;
    const inScope = selectedIdSet
      ? base.filter((asset) => selectedIdSet.has(asset.fileId))
      : base;

    return inScope.map((asset) => ({
      fileId: asset.fileId,
      fileExtension: asset.fileExtension,
    }));
  }, [
    onlyFilteredAssets,
    hasActiveFilters,
    onlySelectedAssets,
    hasSelectedAssets,
    filteredAssets,
    allAssets,
    selectedIds,
  ]);

  // "the 12 filtered assets" — a noun phrase the settings panels drop into
  // their intro sentence, so the wording tracks the checkboxes.
  const scopeSummary = useMemo(() => {
    const useFiltered = onlyFilteredAssets && hasActiveFilters;
    const useSelected = onlySelectedAssets && hasSelectedAssets;
    const count = scopedAssets.length;
    const noun = count === 1 ? 'asset' : 'assets';

    if (useFiltered && useSelected) {
      return `${count} ${noun} that are both filtered and selected`;
    } else if (useFiltered) {
      return `the ${count} filtered ${noun}`;
    } else if (useSelected) {
      return `the ${count} selected ${noun}`;
    }
    return `all ${count} ${noun}`;
  }, [
    onlyFilteredAssets,
    hasActiveFilters,
    onlySelectedAssets,
    hasSelectedAssets,
    scopedAssets.length,
  ]);

  return {
    scopedAssets,
    scopedCount: scopedAssets.length,
    scopeSummary,
    hasActiveFilters,
    filteredCount: filteredAssets.length,
    hasSelectedAssets,
    selectedAssetsCount,
    onlyFilteredAssets,
    setOnlyFilteredAssets,
    onlySelectedAssets,
    setOnlySelectedAssets,
  };
}
