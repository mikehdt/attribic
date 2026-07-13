import type { TrainingProvider } from '@/app/services/training/types';
import type { FormState } from '@/app/store/training-config/types';

/** Per-project metadata. One of these per saved training project. */
export type TrainingProjectMeta = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  latestVersion: number;
};

/** A single version snapshot. One of these per `v{N}.json` file. */
export type TrainingProjectVersion = {
  version: number;
  label: string | null;
  savedAt: string;
  form: FormState;
};

/** The bits of a dataset the load UI needs to render its thumbnail. */
export type TrainingProjectDatasetSummary = {
  projectName: string;
  thumbnail?: string;
  thumbnailVersion?: number;
};

/**
 * A version's identity in a list summary. The full `form` is stripped, but the
 * model, backend and datasets are surfaced so the load UI can show what each
 * project / version trains without loading the whole form.
 */
export type TrainingProjectVersionSummary = Pick<
  TrainingProjectVersion,
  'version' | 'label' | 'savedAt'
> & {
  modelId: string;
  selectedProvider: TrainingProvider;
  datasets: TrainingProjectDatasetSummary[];
};

/** Summary returned by list endpoints — meta plus available versions. */
export type TrainingProjectSummary = TrainingProjectMeta & {
  versions: TrainingProjectVersionSummary[];
};
