/**
 * Client-side reconstruction of the LR schedule shape as a normalised 0–1
 * curve. Backends don't stream per-step LR reliably (Kohya's progress bar
 * carries none), so the chart's background layer is derived from the job's
 * scheduler config instead — which also lets it span the whole run up front
 * rather than only the steps observed so far.
 */

import { hasCapability } from './provider-capabilities';
import type { TrainingProvider } from './types';

type LrScheduleArgs = {
  scheduler: string | undefined;
  totalSteps: number;
  warmupSteps?: number;
  /** Cycle count for cosine_with_restarts (Kohya's lr_scheduler_num_cycles). */
  numRestarts?: number;
  /**
   * Backend that will run the schedule. Omitted draws the ideal shape; passing
   * it drops a warmup ramp the backend won't honour (see
   * {@link schedulerUsesWarmup}).
   */
  provider?: TrainingProvider;
};

const CURVE_POINTS = 96;

/**
 * Whether `warmupSteps` changes anything for this backend/scheduler pair.
 *
 * sd-scripts backends route every scheduler through diffusers'
 * `get_*_schedule_with_warmup`, so a warmup ramp precedes whatever decay
 * follows. ai-toolkit builds torch schedulers directly
 * (`toolkit/scheduler.py`) and only its `constant_with_warmup` branch takes a
 * warmup count — `CosineAnnealingLR` and friends have nowhere to put one, so
 * offering the field there would be a knob that does nothing.
 */
export function schedulerUsesWarmup(
  scheduler: string,
  provider?: TrainingProvider,
): boolean {
  if (scheduler === 'constant') return false;
  if (provider && !hasCapability(provider, 'lrWarmupAnySchedule')) {
    return scheduler === 'constant_with_warmup';
  }
  return true;
}

function decayFor(
  scheduler: string,
  numRestarts: number,
): ((t: number) => number) | null {
  switch (scheduler) {
    case 'constant':
    case 'constant_with_warmup':
      return () => 1;
    case 'linear':
      return (t) => 1 - t;
    case 'cosine':
      return (t) => 0.5 * (1 + Math.cos(Math.PI * t));
    case 'cosine_with_restarts': {
      const cycles = Math.max(1, Math.round(numRestarts));
      // Matches diffusers: each cycle decays 1 → 0 then snaps back up.
      return (t) =>
        t >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * ((cycles * t) % 1)));
    }
    default:
      return null;
  }
}

/**
 * Returns null when there's nothing worth drawing: unknown scheduler, or a
 * flat constant schedule with no warmup (a full-plot wash carries no
 * information).
 */
export function buildLrScheduleCurve({
  scheduler,
  totalSteps,
  warmupSteps = 0,
  numRestarts = 1,
  provider,
}: LrScheduleArgs): number[] | null {
  if (!scheduler) return null;
  const decay = decayFor(scheduler, numRestarts);
  if (!decay) return null;

  const effectiveWarmup = schedulerUsesWarmup(scheduler, provider)
    ? warmupSteps
    : 0;
  const warmupFrac =
    totalSteps > 0 ? Math.min(Math.max(effectiveWarmup / totalSteps, 0), 1) : 0;
  if (scheduler === 'constant' && warmupFrac === 0) return null;

  return Array.from({ length: CURVE_POINTS }, (_, i) => {
    const t = i / (CURVE_POINTS - 1);
    if (warmupFrac > 0 && t < warmupFrac) return t / warmupFrac;
    const progress = warmupFrac < 1 ? (t - warmupFrac) / (1 - warmupFrac) : 1;
    return decay(progress);
  });
}
