'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import { selectDatasets } from '@/app/store/training-config';
import { ensureDatasetScans } from '@/app/store/training-config/thunks';

/**
 * Keep every attached dataset backed by a current reading of the disk.
 *
 * A config names the folders it trains on and nothing else — the folder
 * listing, the per-folder image counts, and the size histogram the bucket
 * preview is built from are all stripped on save and re-read on load. So a
 * form whose datasets haven't been scanned isn't merely missing a detail: it
 * renders zero images, zero steps and an empty bucket list for a project that
 * is sitting on disk perfectly intact.
 *
 * That read used to be fired once, from inside whichever thunk had just
 * replaced the form. It's driven from here instead because a load rarely
 * happens on its own: hydrating a project moves the URL to match it, and the
 * navigation that follows both remounts this tree and can carry off the
 * requests that were in flight when it started. Picking from the Recent
 * Projects menu does exactly that — and unlike a bookmark or a refresh, where
 * the URL already matches and nothing navigates, it loses the scan every time.
 *
 * Being an effect is the whole point: it re-enters after the navigation
 * settles and asks again. {@link ensureDatasetScans} skips datasets that
 * already have a scan, so once the numbers are in this costs nothing, and the
 * repeat can't turn into a loop — the dependencies only move when a dataset is
 * attached, detached, or replaced wholesale by a load.
 */
export function useDatasetScanSync(): void {
  const dispatch = useAppDispatch();
  const pathname = usePathname();
  const datasets = useAppSelector(selectDatasets);

  const attached = datasets.map((ds) => ds.folderName).join('\n');
  const hasUnscanned = datasets.some((ds) => !ds.scan);

  useEffect(() => {
    if (!hasUnscanned) return;
    void dispatch(ensureDatasetScans());
  }, [attached, hasUnscanned, pathname, dispatch]);
}
