import { memo } from 'react';

import { CaptionManager } from './caption-manager';
import { TaggingManager } from './tagging-manager';

type HybridManagerProps = {
  assetId: string;
};

/**
 * Hybrid editor: a natural-language caption on top, booru-style tags below.
 *
 * Both sub-editors point at the same asset and edit independent slices of state
 * (captionText vs tagList). The save path composes them into a single `.txt`
 * with the `__` delimiter between the tag block and the caption.
 */
const HybridManagerComponent = ({ assetId }: HybridManagerProps) => {
  return (
    <div className="flex h-full w-full flex-col gap-3">
      <section className="flex flex-col gap-1">
        <span className="px-1 text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
          Tags
        </span>
        <TaggingManager assetId={assetId} />
      </section>

      <hr className="border-slate-200 dark:border-slate-700" />

      <section className="flex flex-col gap-1">
        <span className="px-1 text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
          Caption
        </span>
        <CaptionManager assetId={assetId} />
      </section>
    </div>
  );
};

export const HybridManager = memo(HybridManagerComponent);
