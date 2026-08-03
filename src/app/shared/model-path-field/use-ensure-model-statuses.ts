import { useEffect } from 'react';

import { useAppDispatch } from '@/app/store/hooks';
import { fetchModelStatuses } from '@/app/store/model-manager';

/**
 * Fetches model manager statuses and writes them into Redux.
 *
 * Called wherever the UI needs to know whether a downloadable model is
 * installed locally — primarily the training config form. Re-runs whenever
 * `enabled` flips to true, so it's safe to gate on modal open state.
 */
export function useEnsureModelStatuses(enabled: boolean = true): void {
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (!enabled) return;
    dispatch(fetchModelStatuses());
  }, [enabled, dispatch]);
}
