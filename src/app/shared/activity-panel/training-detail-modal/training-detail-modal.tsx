import { Modal } from '@/app/shared/modal';

import { TrainingDetailContent } from './training-detail-content';
import { useTrainingDetailModal } from './use-training-detail-modal';

type TrainingDetailModalProps = {
  /** The job to show, or null when no detail modal should be open. */
  jobId: string | null;
  onClose: () => void;
};

/**
 * Enlarged detail view for a live training job's activity card. Lives at the
 * activity-panel level (not inside a job card) and reads its job straight from
 * Redux by ID, so it keeps live-updating even after the activity panel hides
 * itself while this modal is open. The run-history modal reuses the same
 * {@link TrainingDetailContent} body against an archived snapshot.
 */
export function TrainingDetailModal({
  jobId,
  onClose,
}: TrainingDetailModalProps) {
  const { job } = useTrainingDetailModal(jobId, onClose);
  const isOpen = jobId !== null && job !== null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="w-full max-w-3xl">
      <TrainingDetailContent job={job} />
    </Modal>
  );
}
