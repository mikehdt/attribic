/**
 * Hook for the per-model training setup tab.
 *
 * Owns the selected model, the defaults draft, and its debounced autosave.
 * Paths save as the user types (the defaults API merges per-model and
 * treats empty strings as deletions, so partial writes are safe); the
 * merged response is pushed into the training-config slice so an open
 * training form picks changes up live.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  getModelReadiness,
  type ModelReadiness,
} from '@/app/services/training/model-configured';
import {
  getModelById,
  getModelsByArchitecture,
  type ModelComponentType,
  type ModelDefinition,
} from '@/app/services/training/models';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import {
  selectAllModelStatuses,
  selectModelManagerInitialModelId,
} from '@/app/store/model-manager';
import { addToast } from '@/app/store/toasts';
import { setAppModelDefaults } from '@/app/store/training-config';
import type { AppModelDefaults } from '@/app/store/training-config/types';

const SAVE_DEBOUNCE_MS = 600;

export function useTrainingTab() {
  const dispatch = useAppDispatch();
  const statuses = useAppSelector(selectAllModelStatuses);
  const initialModelId = useAppSelector(selectModelManagerInitialModelId);

  const groups = useMemo(() => getModelsByArchitecture(), []);
  const firstModelId = groups[0]?.models[0]?.id;

  // Selected model, re-derived when the modal is reopened deep-linked to a
  // specific model (same sync-on-change pattern as the modal's tab state).
  const [userModelId, setUserModelId] = useState<string | undefined>(
    initialModelId ?? firstModelId,
  );
  const [syncedInitialId, setSyncedInitialId] = useState(initialModelId);
  if (initialModelId !== syncedInitialId) {
    setSyncedInitialId(initialModelId);
    if (initialModelId) setUserModelId(initialModelId);
  }

  const selectedModel: ModelDefinition | undefined =
    (userModelId ? getModelById(userModelId) : undefined) ??
    groups[0]?.models[0];

  // --- Defaults draft -----------------------------------------------------

  const [draft, setDraft] = useState<AppModelDefaults>({});

  useEffect(() => {
    let cancelled = false;
    fetch('/api/config/model-defaults')
      .then((r) => r.json())
      .then((data: AppModelDefaults) => {
        if (!cancelled) setDraft(data);
      })
      .catch(() => {
        // Draft starts empty; a failed save will surface an error toast
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Changes not yet sent, accumulated across fields/models between flushes.
  const pendingRef = useRef<AppModelDefaults>({});
  const timerRef = useRef<number | null>(null);

  const flush = useCallback(async () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const patch = pendingRef.current;
    pendingRef.current = {};
    if (Object.keys(patch).length === 0) return;

    try {
      const res = await fetch('/api/config/model-defaults', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      // A non-OK answer still parses as JSON, so without this check an error
      // body would be applied as though it were the saved defaults.
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      const saved = (await res.json()) as AppModelDefaults;
      dispatch(setAppModelDefaults(saved));
    } catch (err) {
      dispatch(
        addToast({
          children:
            err instanceof Error
              ? `Couldn't save model defaults: ${err.message}`
              : "Couldn't save model defaults",
          variant: 'error',
        }),
      );
    }
  }, [dispatch]);

  const setPath = useCallback(
    (modelId: string, component: ModelComponentType, path: string) => {
      setDraft((prev) => ({
        ...prev,
        [modelId]: { ...prev[modelId], [component]: path },
      }));
      pendingRef.current = {
        ...pendingRef.current,
        [modelId]: { ...pendingRef.current[modelId], [component]: path },
      };
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        void flush();
      }, SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  // Flush any pending edits when the tab unmounts (tab switch, modal close).
  useEffect(
    () => () => {
      void flush();
    },
    [flush],
  );

  // --- Readiness ----------------------------------------------------------

  const readiness = useMemo(() => {
    const map: Record<string, ModelReadiness> = {};
    for (const group of groups) {
      for (const model of group.models) {
        map[model.id] = getModelReadiness(model, draft[model.id], statuses);
      }
    }
    return map;
  }, [groups, draft, statuses]);

  return {
    groups,
    selectedModel,
    selectModel: setUserModelId,
    draft,
    setPath,
    readiness,
    statuses,
  };
}
