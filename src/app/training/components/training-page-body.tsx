'use client';

import { useCallback } from 'react';

import { useAppDispatch } from '@/app/store/hooks';
import { startTraining } from '@/app/store/training/training-runtime';
import type { FormState } from '@/app/store/training-config/types';

import { TrainingConfigForm } from './training-config-form/training-config-form';
import { useTrainingRouteSync } from './use-training-route-sync';

/**
 * The training view itself, shared by every `/training` route variant.
 *
 * The slug and version segments only exist to make the view restorable — they
 * change no rendering, so all three routes mount the same body and let
 * {@link useTrainingRouteSync} reconcile the URL with the loaded project.
 */
export const TrainingPageBody = () => {
  const dispatch = useAppDispatch();

  useTrainingRouteSync();

  const handleStartTraining = useCallback(
    (config: Record<string, unknown>, formSnapshot: FormState) => {
      dispatch(startTraining(config, formSnapshot));
    },
    [dispatch],
  );

  return (
    <div className="py-6">
      <TrainingConfigForm onStartTraining={handleStartTraining} />
    </div>
  );
};
