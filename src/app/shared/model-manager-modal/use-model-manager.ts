/**
 * Hook for the model manager modal shell.
 *
 * Responsible only for modal-level concerns:
 * - Reading open/active-tab state from Redux
 * - Triggering a status scan whenever the modal opens
 *
 * Per-tab data (model registries, download jobs, handlers) lives in the
 * tab components themselves so they can be self-contained.
 */

import { useCallback, useEffect, useState } from 'react';

import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import {
  closeModelManagerModal,
  fetchModelStatuses,
  selectIsModelManagerModalOpen,
  selectModelManagerInitialTab,
} from '@/app/store/model-manager';
import type { ModelEntry } from '@/app/store/model-manager/types';

type Tab = 'auto-tagger' | 'training' | 'settings';

export function useModelManager() {
  const dispatch = useAppDispatch();
  const isOpen = useAppSelector(selectIsModelManagerModalOpen);
  const initialTab = useAppSelector(selectModelManagerInitialTab);

  // Track the tab the user has clicked, plus the last `initialTab` we
  // synced from. When `initialTab` changes (e.g. modal reopened with a
  // specific tab) we re-derive the active tab from it during render —
  // this is the React-recommended pattern for "sync state on prop change"
  // and avoids the set-state-in-effect lint rule.
  const [userTab, setUserTab] = useState<Tab>(initialTab ?? 'auto-tagger');
  const [syncedInitialTab, setSyncedInitialTab] = useState<Tab | undefined>(
    initialTab,
  );

  if (initialTab !== syncedInitialTab) {
    setSyncedInitialTab(initialTab);
    if (initialTab) setUserTab(initialTab);
  }

  const activeTab = userTab;
  const setActiveTab = setUserTab;

  // Fetch model statuses from disk when the modal opens
  useEffect(() => {
    if (!isOpen) return;
    dispatch(fetchModelStatuses());
  }, [isOpen, dispatch]);

  const handleClose = useCallback(() => {
    dispatch(closeModelManagerModal());
  }, [dispatch]);

  return {
    isOpen,
    activeTab,
    setActiveTab,
    handleClose,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get the status string for a model from the Redux state. */
export function getModelStatus(
  statuses: Record<string, ModelEntry>,
  modelId: string,
): string {
  return statuses[modelId]?.status ?? 'not_installed';
}
