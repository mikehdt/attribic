import type { SampleImage } from '@/app/services/training/types';
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
  /** Row stamp, e.g. "Step 500" or "Epoch 3". */
  label: string;
  /** Secondary line under the label — the upcoming row's "~10m" ETA. */
  sublabel?: string;
  /** True when the run samples on an epoch cadence (label reads "Epoch N"). */
  isEpoch: boolean;
  /** A predicted future event: every cell renders as a placeholder. */
  upcoming?: boolean;
  /** One cell per column; null where that prompt hasn't been sampled yet. */
  cells: (SampleImage | null)[];
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
  const groups = new Map<
    string,
    { sortValue: number; row: SampleRow }
  >();

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
          label: isEpoch ? `Epoch ${sample.epoch}` : `Step ${sample.step}`,
          isEpoch,
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

/**
 * URL for a sample served by `/api/training/samples/[...path]`. The stored path
 * is loras-root-relative with POSIX separators — encode each segment but keep
 * the separators so the route's `[...path]` splits it back correctly.
 */
export function sampleUrl(relativePath: string): string {
  const encoded = relativePath.split('/').map(encodeURIComponent).join('/');
  return `/api/training/samples/${encoded}`;
}
