import { useEffect } from 'react';

import { useAppSelector } from '@/app/store/hooks';
import { selectJobById, type TaggingJob } from '@/app/store/jobs';

/**
 * Resolves the live tagging job for the activity panel's detail modal. Reads
 * the job straight from Redux by ID (rather than as a prop) so the modal keeps
 * live-updating and stays mounted even while the activity panel that would
 * otherwise pass it down has hidden itself for having a modal open.
 */
export function useTaggingDetailModal(
  jobId: string | null,
  onClose: () => void,
) {
  const job = useAppSelector((state): TaggingJob | null => {
    if (!jobId) return null;
    const found = selectJobById(state, jobId);
    return found && found.type === 'tagging' ? found : null;
  });

  // If the job disappears from the list while the modal is open (cleared,
  // or dropped on refresh), close rather than show stale/empty content.
  useEffect(() => {
    if (jobId && !job) onClose();
  }, [jobId, job, onClose]);

  return { job };
}
