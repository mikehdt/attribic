import { useCallback, useEffect, useRef } from 'react';

import type { TrainingJob } from '@/app/store/jobs';

import { useLrScheduleCurve } from '../use-lr-schedule-curve';

/**
 * Derives everything the training detail *content* needs from a single job:
 * its progress/config, the LR-schedule curve, and an auto-scrolling log ref.
 * Job-only (no Redux lookup), so it works for both a live job (activity panel)
 * and a static snapshot from the run-history archive.
 */
export function useTrainingDetailView(job: TrainingJob | null) {
  const progress = job?.progress ?? null;
  const config = job?.config ?? null;

  // During preparing, currentStep/totalSteps carry the setup phase's own item
  // count (e.g. latents cached), not training steps — so there's no step total
  // to plot an LR schedule against yet.
  const isPreparing = job?.status === 'preparing';
  const totalSteps = isPreparing ? 0 : (progress?.totalSteps ?? 0);
  const lrCurve = useLrScheduleCurve(config, totalSteps);

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

  return { progress, config, lrCurve, isPreparing, logRef, handleLogScroll };
}
