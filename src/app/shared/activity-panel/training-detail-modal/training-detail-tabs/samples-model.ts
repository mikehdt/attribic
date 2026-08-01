import type {
  SampleImage,
  SampleProgress,
} from '@/app/services/training/types';
import type { TrainingJob } from '@/app/store/jobs';

/** A prompt column in the samples grid. */
export type SampleColumn = {
  /** The prompt index this column maps to (the sample's `promptIndex`). */
  index: number;
  /** Truncated-in-CSS header text; full text lives on the title attr/lightbox. */
  label: string;
};

/** One sampling event (a row): every prompt sampled at the same step/epoch. */
export type SampleRow = {
  /** Stable key for the grouped sampling event. */
  key: string;
  /**
   * Row stamp, e.g. "Step 500", "Epoch 3", "Generating" for the event the
   * trainer is mid-way through, or "~4m" on the upcoming placeholder. Absent
   * when there's nothing meaningful to stamp (a placeholder with no ETA yet).
   */
  label?: string;
  /** True when the run samples on an epoch cadence (label reads "Epoch N"). */
  isEpoch: boolean;
  /**
   * The position this event sits at — its epoch on an epoch-cadence run, its
   * step otherwise (epoch-cadence sample filenames encode no step). Rows sort
   * on it, and comparing it against the trainer's frozen counters is how the
   * live view tells this event apart from the one about to start. Absent on
   * placeholder rows, which sit at no position at all.
   */
  eventValue?: number;
  /** A predicted future event: every cell renders as a placeholder. */
  upcoming?: boolean;
  /** One cell per column; null where that prompt hasn't been sampled yet. */
  cells: (SampleImage | null)[];
  /**
   * Column index of the image the trainer is rendering right now. Set on the
   * in-flight event only (display overlay, not the base grid) so that one cell
   * shows a progress bar instead of an empty placeholder — and so the empty
   * cells behind it, whose images are written but not yet claimed, read as
   * pending rather than as nothing.
   */
  generatingIndex?: number;
  /**
   * How far through that image the sampler is, or null when the backend
   * doesn't report it — the cell then runs an indeterminate bar.
   */
  generatingProgress?: SampleProgress | null;
};

export type SamplesGridModel = {
  columns: SampleColumn[];
  rows: SampleRow[];
};

/**
 * Build the samples grid from a job's live/archived progress. Columns are the
 * configured prompts (falling back to "Prompt N" where a sample's index runs
 * past the list); rows are sampling events grouped by epoch (epoch-cadence
 * runs, where step is 0) or step, newest first.
 *
 * A run with sampling configured but no images yet still gets its prompt
 * columns (from the predicted `sampleSteps`), so the table can render as an
 * empty frame from the moment the run starts — confirmation the setting took.
 */
export function buildSamplesGrid(job: TrainingJob | null): SamplesGridModel {
  const samples = job?.progress?.samples ?? [];
  const prompts = job?.config?.samplePrompts ?? [];
  const samplingExpected = (job?.progress?.sampleSteps ?? []).length > 0;

  if (samples.length === 0 && !samplingExpected) {
    return { columns: [], rows: [] };
  }

  const maxPromptIndex = samples.reduce(
    (max, s) => Math.max(max, s.promptIndex),
    -1,
  );
  const columnCount = Math.max(prompts.length, maxPromptIndex + 1);
  if (columnCount === 0) return { columns: [], rows: [] };

  const columns: SampleColumn[] = Array.from(
    { length: columnCount },
    (_, i) => ({
      index: i,
      label: prompts[i]?.trim() || `Prompt ${i + 1}`,
    }),
  );

  // Group by sampling event: epoch-cadence runs carry a non-null epoch (step is
  // 0), step-cadence runs carry a null epoch. Key + sort value follow whichever
  // unit the run actually samples on.
  const groups = new Map<string, { sortValue: number; row: SampleRow }>();

  for (const sample of samples) {
    const isEpoch = sample.epoch != null;
    const key = isEpoch ? `e${sample.epoch}` : `s${sample.step}`;
    const sortValue = isEpoch ? (sample.epoch as number) : sample.step;

    let group = groups.get(key);
    if (!group) {
      group = {
        sortValue,
        row: {
          key,
          label: isEpoch
            ? `Epoch ${sample.epoch!.toLocaleString()}`
            : `Step ${sample.step.toLocaleString()}`,
          isEpoch,
          eventValue: sortValue,
          cells: Array.from({ length: columnCount }, () => null),
        },
      };
      groups.set(key, group);
    }

    if (sample.promptIndex >= 0 && sample.promptIndex < columnCount) {
      group.row.cells[sample.promptIndex] = sample;
    }
  }

  const rows = Array.from(groups.values())
    .sort((a, b) => b.sortValue - a.sortValue)
    .map((g) => g.row);

  return { columns, rows };
}

/**
 * Whether the detail view gets the samples treatment — the Samples tab and the
 * wider modal. A live run qualifies as soon as sampling is configured (the
 * empty grid frame is the confirmation the setting took); a terminal run only
 * when images actually exist. Host modals key their width off this so they're
 * wide from the start rather than jumping when the first image lands.
 * `useTrainingDetailTabs` passes its memoised grid to avoid a rebuild.
 */
export function showsSamplesView(
  job: TrainingJob | null,
  grid: SamplesGridModel = buildSamplesGrid(job),
): boolean {
  const isLive = job?.status === 'running' || job?.status === 'preparing';
  return grid.columns.length > 0 && (grid.rows.length > 0 || isLive);
}

/** A stored archived path: `jobs/<jobId>/samples/<file>`. */
const ARCHIVED_PATH = /^jobs\/([^/]+)\/samples\/(.+)$/;

/**
 * URL for a sample served by `/api/training/samples/[...path]`. The first URL
 * segment names the root the rest resolves against, so the route never has to
 * guess:
 *
 * - archived (`jobs/<id>/samples/<file>` under the training root) →
 *   `jobs/<id>/<file>`, the fixed `samples` subdir being the route's to add
 *   back — which is what kept "samples" in the URL twice.
 * - anything else (`sample/<file>`, `<name>/samples/<file>`, still where the
 *   trainer wrote it) → `loras/<path>`.
 *
 * Stored paths themselves are untouched: they're what the archive route and the
 * sidecar work in, and persisted history is full of them.
 */
export function sampleUrl(relativePath: string): string {
  const archived = ARCHIVED_PATH.exec(relativePath);
  const segments = archived
    ? ['jobs', archived[1], ...archived[2].split('/')]
    : ['loras', ...relativePath.split('/')];
  return `/api/training/samples/${segments.map(encodeURIComponent).join('/')}`;
}
