import { TRAINING_PROVIDER_LABELS } from '@/app/services/training/types';
import { SegmentedControl } from '@/app/shared/segmented-control/segmented-control';
import type { TrainingJob } from '@/app/store/jobs';

import { formatDuration } from '../../helpers';
import { SamplesGrid } from '../samples-grid/samples-grid';
import { SamplesLightbox } from '../samples-lightbox/samples-lightbox';
import { TrainingDetailContent } from '../training-detail-content';
import { useTrainingDetailView } from '../use-training-detail-view';
import { useTrainingDetailTabs } from './use-training-detail-tabs';

/**
 * Tabbed shell around {@link TrainingDetailContent}: an Overview tab (the
 * unchanged detail body) and a Samples tab (the previews grid + in-place
 * lightbox). Shared by the live activity-panel modal and the run-history modal
 * so both get the tabs from one place. The Samples tab appears as soon as a
 * live run has sampling configured — before any image exists, it renders the
 * prompt columns and an upcoming-event placeholder row so it's visible the
 * setting took. Runs without sampling render exactly the Overview body with no
 * tab control, so the modal looks as before.
 */
export function TrainingDetailTabs({ job }: { job: TrainingJob | null }) {
  const {
    grid,
    showSamplesTab,
    hasRows,
    tab,
    setTab,
    lightbox,
    openLightbox,
    closeLightbox,
    move,
    nav,
    activeRow,
    activeColumn,
    activeSample,
  } = useTrainingDetailTabs(job);

  const { config, progress } = useTrainingDetailView(job);

  if (!job || !progress) return null;

  const isCompleted = job.status === 'completed';

  const elapsed =
    progress.completedAt != null && progress.startedAt != null
      ? progress.completedAt - progress.startedAt
      : null;

  const modalHeader = (
    <div>
      <h2 className="text-sm font-medium text-(--foreground)">
        {config?.outputName || 'Training run'}
      </h2>
      <p className="text-xs text-slate-400">
        {TRAINING_PROVIDER_LABELS[config?.provider ?? 'mock']}
        {isCompleted && elapsed != null
          ? ` · Completed in ${formatDuration(elapsed)}`
          : ''}
      </p>
    </div>
  );

  if (!showSamplesTab)
    return (
      <div className="relative">
        {modalHeader}
        <TrainingDetailContent job={job} />
      </div>
    );

  // No `overflow-hidden` here: the lightbox overlay deliberately extends over
  // the modal's p-6 padding (see its `-inset-6`) to cover the Modal's own close
  // button, and it carries its own rounding, so nothing needs clipping here.
  // While the lightbox is open the wrapper gets a min-height so the preview
  // isn't cramped when the grid behind it is only a row or two tall — the
  // overlay is absolutely pinned to this wrapper, so this is what sizes it.
  return (
    <div className={lightbox ? 'relative min-h-[70vh]' : 'relative'}>
      {modalHeader}

      {/* Sit the tab control left of the modal's absolute close button. */}
      <div className="mb-4 pr-8">
        <SegmentedControl
          options={[
            { value: 'overview' as const, label: 'Overview' },
            { value: 'samples' as const, label: 'Samples' },
          ]}
          value={tab}
          onChange={setTab}
          size="sm"
          width="full"
        />
      </div>

      {tab === 'overview' ? (
        <TrainingDetailContent job={job} />
      ) : (
        <div className="max-h-[70vh] overflow-y-auto">
          <SamplesGrid grid={grid} onOpen={openLightbox} />

          {!hasRows && (
            <p className="mt-2 text-sm text-slate-400">
              No sample images yet — they&apos;ll appear here as they&apos;re
              generated.
            </p>
          )}
        </div>
      )}

      {lightbox && activeSample && activeRow && activeColumn && nav && (
        <SamplesLightbox
          sample={activeSample}
          row={activeRow}
          column={activeColumn}
          nav={nav}
          onClose={closeLightbox}
          onMove={move}
        />
      )}
    </div>
  );
}
