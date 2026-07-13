import { useMemo } from 'react';

import { buildLrScheduleCurve } from '@/app/services/training/lr-schedule';
import type { TrainingJob } from '@/app/store/jobs';

/**
 * The job's LR schedule as a normalised 0–1 curve, for the loss chart's
 * background layer. Shared by the activity-panel card and the detail view so
 * both draw the same schedule from the same config.
 */
export function useLrScheduleCurve(
  config: TrainingJob['config'] | null,
  totalSteps: number,
): number[] | null {
  return useMemo(() => {
    const hp = config?.hyperparameters;
    if (!hp) return null;
    return buildLrScheduleCurve({
      scheduler: hp.scheduler,
      totalSteps,
      warmupSteps: hp.warmupSteps ?? 0,
      numRestarts: Number(hp.extra?.numRestarts ?? 1) || 1,
    });
  }, [config, totalSteps]);
}
