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

/** Summary returned by list endpoints — meta plus available versions. */
export type TrainingProjectSummary = TrainingProjectMeta & {
  versions: Array<
    Pick<TrainingProjectVersion, 'version' | 'label' | 'savedAt'>
  >;
};
