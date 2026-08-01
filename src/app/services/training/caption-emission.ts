/**
 * Which half of a caption a training run feeds the trainer.
 *
 * A `hybrid` project stores imageboard-style tags and a natural-language
 * caption in one `.txt` (see `store/assets/hybrid-caption.ts`), because a
 * dataset is worth captioning once and training many times. Which half a model
 * wants differs by architecture, so the choice belongs to the run rather than
 * to the file on disk — see `docs/caption-composition-design.md`.
 *
 * Everything here is pure resolution and wording. The split itself happens in
 * the sidecar at launch, off the delimiter in the file; nothing in this module
 * reads a caption.
 */

import type { CaptionMode } from '@/app/store/project/types';

import { getModelById, type ModelArchitecture } from './models';

export type CaptionEmission = 'tags' | 'both' | 'natural';

/** Segment labels. Short, because all three sit in one control. */
export const CAPTION_EMISSION_LABELS: Record<CaptionEmission, string> = {
  tags: 'Tags',
  both: 'Both',
  natural: 'Natural',
};

/**
 * What each architecture was trained on. A fact about the model rather than a
 * tunable, so it lives here and not in `TrainingDefaults` — everything in there
 * is a diffable form field with a reset affordance, which this is not.
 */
const ARCHITECTURE_PREFERENCE: Record<ModelArchitecture, CaptionEmission> = {
  sdxl: 'tags',
  anima: 'both',
  zimage: 'natural',
  flux: 'natural',
  wan: 'natural',
  ltx: 'natural',
};

/**
 * The emission a model wants. Unknown models fall back to `both`, which is the
 * only answer that discards nothing.
 */
export function captionPreferenceForModel(modelId: string): CaptionEmission {
  const model = getModelById(modelId);
  return model ? ARCHITECTURE_PREFERENCE[model.architecture] : 'both';
}

/**
 * Whether the project's caption mode leaves the user anything to choose.
 *
 * Only hybrid does: every other mode stores one thing, so its emission is
 * whatever that thing is.
 */
export function isEmissionChoosable(mode: CaptionMode | undefined): boolean {
  return mode === 'hybrid';
}

/** What a non-hybrid file already is, with no composition involved. */
function inherentEmission(mode: CaptionMode): CaptionEmission {
  return mode === 'caption' ? 'natural' : 'tags';
}

/**
 * The emission a dataset will actually train on.
 *
 * `pinned` is only consulted for hybrid projects — a pin on a project that has
 * since been retagged to a single-caption mode describes a choice that no
 * longer exists, and the file's own content is the only correct answer.
 */
export function resolveCaptionEmission({
  captionMode,
  pinned,
  modelId,
}: {
  captionMode: CaptionMode;
  pinned: CaptionEmission | null | undefined;
  modelId: string;
}): CaptionEmission {
  if (captionMode !== 'hybrid') return inherentEmission(captionMode);
  return pinned ?? captionPreferenceForModel(modelId);
}

/** How an emission reads when describing what the user chose. */
const CHOICE_PHRASE: Record<CaptionEmission, string> = {
  tags: 'tags only',
  both: 'tags and natural language together',
  natural: 'natural language only',
};

/** How a preference reads when describing what a model was trained on. */
const TRAINED_ON_PHRASE: Record<CaptionEmission, string> = {
  tags: 'keyword tags',
  both: 'tags and natural language together',
  natural: 'natural language',
};

/** How a single-mode dataset describes itself. */
const DATASET_PHRASE: Record<CaptionMode, string> = {
  tags: 'tagged only',
  caption: 'natural language only',
  hybrid: 'both tags and natural language',
};

/**
 * A note about a dataset the model would rather have had differently, or null
 * when there is nothing worth saying.
 *
 * Informational only. Training a tag-captioned set into an NL model is a
 * legitimate thing to do deliberately and a poor thing to do by accident, and
 * the only difference between the two is whether anyone mentioned it.
 */
export function captionEmissionAdvice({
  captionMode,
  pinned,
  modelId,
}: {
  captionMode: CaptionMode | undefined;
  pinned: CaptionEmission | null | undefined;
  modelId: string;
}): string | null {
  if (!captionMode) return null;

  const preference = captionPreferenceForModel(modelId);
  const modelName = getModelById(modelId)?.name ?? 'this model';

  // Hybrid can satisfy any preference, so the only thing worth flagging is the
  // user having pinned away from it.
  if (captionMode === 'hybrid') {
    const emission = pinned ?? preference;
    if (emission === preference) return null;
    return `Set to ${CHOICE_PHRASE[emission]}, but ${modelName} trains best on ${TRAINED_ON_PHRASE[preference]}.`;
  }

  const inherent = inherentEmission(captionMode);
  if (inherent === preference) return null;

  // A `both` model is only half-served rather than mismatched, so it gets the
  // softer wording.
  if (preference === 'both') {
    return `${modelName} trains best on ${TRAINED_ON_PHRASE.both}; this dataset is ${DATASET_PHRASE[captionMode]}.`;
  }

  return `This dataset is ${DATASET_PHRASE[captionMode]}, but ${modelName} was trained on ${TRAINED_ON_PHRASE[preference]}.`;
}
