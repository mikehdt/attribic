/**
 * Save/sample cadence derivation, shared by the sidecar request builder (what
 * cadence to send) and the client-side job-card display (what steps that
 * cadence lands on). Single source of truth for the "one active unit, the
 * other zeroed" rule — see {@link resolveSaveCadence}.
 */

import type { TrainingFormValues } from './form-values';

type Cadence = { everyNSteps: number; everyNEpochs: number };

/**
 * The save cadence in the shape the sidecar expects: exactly one field
 * non-zero, matching the user's chosen unit (steps take precedence when the
 * sidecar reads them; 0/0 means saving is disabled). Sending the user's unit
 * as-is rather than collapsing a step interval into epochs is what stops that
 * interval being silently dropped.
 */
export function resolveSaveCadence(form: TrainingFormValues): Cadence {
  if (!form.saveEnabled) return { everyNSteps: 0, everyNEpochs: 0 };
  return {
    everyNEpochs: form.saveMode === 'epochs' ? form.saveEveryEpochs : 0,
    everyNSteps: form.saveMode === 'steps' ? form.saveEverySteps : 0,
  };
}

/** Sampling's twin of {@link resolveSaveCadence}. */
export function resolveSampleCadence(form: TrainingFormValues): Cadence {
  if (!form.samplingEnabled) return { everyNSteps: 0, everyNEpochs: 0 };
  return {
    everyNEpochs: form.sampleMode === 'epochs' ? form.sampleEveryEpochs : 0,
    everyNSteps: form.sampleMode === 'steps' ? form.sampleEverySteps : 0,
  };
}

/**
 * Step positions a repeating cadence lands on across a run. Saving and
 * sampling both express their cadence as "every N epochs" or "every N steps"
 * over the same timeline, so they share this: only the config keys and the
 * enablement rule differ.
 */
function deriveCadenceSteps({
  mode,
  everyEpochs,
  everySteps,
  totalSteps,
  epochs,
}: {
  mode: 'epochs' | 'steps';
  everyEpochs: number;
  everySteps: number;
  totalSteps: number;
  epochs: number;
}): number[] {
  const out: number[] = [];
  if (mode === 'epochs' && everyEpochs > 0 && epochs > 0) {
    const stepsPerEpoch = Math.max(1, Math.ceil(totalSteps / epochs));
    for (let e = everyEpochs; e <= epochs; e += everyEpochs) {
      out.push(Math.min(e * stepsPerEpoch, totalSteps));
    }
  } else if (mode === 'steps' && everySteps > 0) {
    for (let s = everySteps; s <= totalSteps; s += everySteps) {
      out.push(s);
    }
  }
  return out;
}

/** Predicted checkpoint step positions from the form's save cadence. */
export function deriveCheckpointSteps(form: TrainingFormValues): number[] {
  if (!form.saveEnabled) return [];
  const { everyNSteps, everyNEpochs } = resolveSaveCadence(form);
  return deriveCadenceSteps({
    mode: form.saveMode,
    everyEpochs: everyNEpochs,
    everySteps: everyNSteps,
    totalSteps: form.steps || 0,
    epochs: form.epochs || 0,
  });
}

/**
 * Predicted sample-generation step positions from the form's sampling
 * cadence. Gated on prompts because that's what actually enables sampling in
 * the providers.
 */
export function deriveSampleSteps(form: TrainingFormValues): number[] {
  const prompts = form.samplePrompts.filter((p) => p.trim());
  if (!form.samplingEnabled || prompts.length === 0) return [];

  const { everyNSteps, everyNEpochs } = resolveSampleCadence(form);
  return deriveCadenceSteps({
    mode: form.sampleMode,
    everyEpochs: everyNEpochs,
    everySteps: everyNSteps,
    totalSteps: form.steps || 0,
    epochs: form.epochs || 0,
  });
}
