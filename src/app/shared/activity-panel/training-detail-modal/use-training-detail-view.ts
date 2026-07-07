import { useCallback, useEffect, useMemo, useRef } from 'react';

import { buildLrScheduleCurve } from '@/app/services/training/lr-schedule';
import type { TrainingJob } from '@/app/store/jobs';

/**
 * Derives everything the training detail *content* needs from a single job:
 * its progress/config, the LR-schedule curve, and an auto-scrolling log ref.
 * Job-only (no Redux lookup), so it works for both a live job (activity panel)
 * and a static snapshot from the run-history archive.
 */
export function useTrainingDetailView(job: TrainingJob | null) {
  const progress = job?.progress ?? null;
  const config = job?.config ?? null;

  const totalSteps = progress?.totalSteps ?? 0;
  const lrCurve = useMemo(() => {
    const hp = config?.hyperparameters;
    if (!hp) return null;
    return buildLrScheduleCurve({
      scheduler: hp.scheduler,
      totalSteps,
      warmupSteps: hp.warmupSteps ?? 0,
      numRestarts: Number(hp.extra?.numRestarts ?? 1) || 1,
    });
  }, [config, totalSteps]);

  // Auto-scroll the log panel to the bottom while training runs, unless the
  // user has scrolled up to read earlier lines.
  const logRef = useRef<HTMLDivElement>(null);
  const pinnedToBottomRef = useRef(true);

  const handleLogScroll = useCallback(() => {
    const el = logRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedToBottomRef.current = distanceFromBottom < 24;
  }, []);

  useEffect(() => {
    if (!pinnedToBottomRef.current) return;
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [progress?.logLines]);

  return { progress, config, lrCurve, logRef, handleLogScroll };
}
