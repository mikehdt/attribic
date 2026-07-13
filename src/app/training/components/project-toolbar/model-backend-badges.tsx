'use client';

import { getModelById } from '@/app/services/training/models';
import { TRAINING_PROVIDER_SHORT_LABELS } from '@/app/services/training/types';
import type { TrainingProjectVersionSummary } from '@/app/services/training-projects/disk-schema';

export const MODEL_BADGE_CLASS =
  'rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300';
export const BACKEND_BADGE_CLASS =
  'rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500 dark:bg-slate-700/60 dark:text-slate-400';

export function modelLabel(modelId: string): string {
  return getModelById(modelId)?.name ?? modelId;
}

/** Model + backend badges for a single saved version. */
export const ModelBackendBadges = ({
  version,
}: {
  version: TrainingProjectVersionSummary;
}) => (
  <span className="flex flex-wrap items-center gap-1">
    <span className={MODEL_BADGE_CLASS}>{modelLabel(version.modelId)}</span>
    <span className={BACKEND_BADGE_CLASS}>
      {TRAINING_PROVIDER_SHORT_LABELS[version.selectedProvider]}
    </span>
  </span>
);
