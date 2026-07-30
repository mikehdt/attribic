import { LayersIcon, TagIcon, TextAlignStartIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  CAPTION_EMISSION_LABELS,
  type CaptionEmission,
  captionPreferenceForModel,
  isEmissionChoosable,
  resolveCaptionEmission,
} from '@/app/services/training/caption-emission';
import {
  SegmentedControl,
  type SegmentOption,
} from '@/app/shared/segmented-control/segmented-control';
import type { CaptionMode } from '@/app/store/project/types';

const EMISSION_ICONS: Record<CaptionEmission, ReactNode> = {
  tags: <TagIcon className="h-4 w-4" aria-hidden />,
  both: <LayersIcon className="h-4 w-4" aria-hidden />,
  natural: <TextAlignStartIcon className="h-4 w-4" aria-hidden />,
};

const OPTIONS: SegmentOption<CaptionEmission>[] = (
  ['tags', 'both', 'natural'] as const
).map((value) => ({
  value,
  label: CAPTION_EMISSION_LABELS[value],
  icon: EMISSION_ICONS[value],
}));

/** What a single-caption project feeds the trainer, said plainly. */
const STATIC_TITLE: Record<CaptionMode, string> = {
  tags: 'Trains on this project’s tags',
  caption: 'Trains on this project’s natural-language captions',
  hybrid: 'Trains on both tags and natural-language captions',
};

type CaptionEmissionControlProps = {
  /** Absent until the project has been read off disk. */
  captionMode: CaptionMode | undefined;
  pinned: CaptionEmission | null | undefined;
  modelId: string;
  onChange: (emission: CaptionEmission | null) => void;
};

/**
 * Which half of a hybrid caption this dataset trains on.
 *
 * Only hybrid projects get a choice — every other mode stores one thing, so
 * there is nothing to choose between and the icon is informational. It is still
 * worth showing: across a multi-project config it makes "what will this feed the
 * trainer" answerable at a glance, the same job the flip and regularisation
 * icons do on the folder rows.
 */
export function CaptionEmissionControl({
  captionMode,
  pinned,
  modelId,
  onChange,
}: CaptionEmissionControlProps) {
  // Nothing honest to draw until the scan lands — a placeholder icon here would
  // be asserting a caption mode we haven't read yet.
  if (!captionMode) return null;

  if (!isEmissionChoosable(captionMode)) {
    const emission = resolveCaptionEmission({ captionMode, pinned, modelId });
    return (
      <span
        className="shrink-0 text-slate-400"
        title={STATIC_TITLE[captionMode]}
      >
        {EMISSION_ICONS[emission]}
        <span className="sr-only">{STATIC_TITLE[captionMode]}</span>
      </span>
    );
  }

  const preference = captionPreferenceForModel(modelId);

  return (
    <SegmentedControl
      options={OPTIONS}
      value={pinned ?? preference}
      // Picking the segment the model would have chosen anyway clears the pin
      // rather than storing it, so it doesn't silently outlive a model switch —
      // same bargain as `overrideRepeats` against the detected repeat count.
      onChange={(value) => onChange(value === preference ? null : value)}
      size="sm"
      tone="surface"
    />
  );
}
