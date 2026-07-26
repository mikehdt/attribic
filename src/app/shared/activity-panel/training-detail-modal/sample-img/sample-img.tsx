import { ImageOffIcon } from 'lucide-react';
import { useState } from 'react';

import { sampleUrl } from '../training-detail-tabs/samples-model';

type SampleImgProps = {
  /** Stored, root-relative sample path — turned into a URL by `sampleUrl`. */
  path: string;
  alt: string;
  /** Applied to the image and, so the slot keeps its size, to the fallback. */
  className: string;
  iconClassName?: string;
  loading?: 'lazy' | 'eager';
};

/**
 * A sample image that degrades to a broken-image icon rather than the browser's
 * torn-page glyph and alt text. Samples do go missing between being recorded
 * and being looked at — a file locked when the run archived, a loras folder
 * cleaned out by hand, a run whose archive was deleted while its history entry
 * lived on — and the run's grid should say so plainly.
 *
 * Callers key this on the sample path: a cell's path is repointed at the
 * archive when a run goes terminal, and the new file deserves its own attempt.
 */
export function SampleImg({
  path,
  alt,
  className,
  iconClassName = 'h-6 w-6',
  loading,
}: SampleImgProps) {
  const [errored, setErrored] = useState(false);

  if (errored) {
    return (
      <div
        className={`flex items-center justify-center ${className}`}
        title={`Sample image missing — ${alt}`}
      >
        <ImageOffIcon
          role="img"
          aria-label={`Sample image missing — ${alt}`}
          className={`text-slate-400 ${iconClassName}`}
        />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- local sample served straight off disk; the optimiser adds nothing, and next/image makes the onError fallback awkward
    <img
      src={sampleUrl(path)}
      alt={alt}
      loading={loading}
      className={className}
      onError={() => setErrored(true)}
    />
  );
}
