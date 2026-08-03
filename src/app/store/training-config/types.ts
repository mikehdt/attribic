import type {
  ConceptualGroup,
  TrainingFieldName,
} from '@/app/services/training/field-registry';
import type {
  DatasetFolder,
  DatasetSource,
  DurationMode,
  ExtraFolder,
  FolderAugmentation,
  TrainingFormValues,
} from '@/app/services/training/form-values';
import type { ModelPaths } from '@/app/services/training/types';

// The pure form data shape lives in services (see form-values.ts) so
// request-building code can depend on it without a services→store import.
// Re-exported here so existing store/component imports are unaffected.
export type {
  DatasetFolder,
  DatasetSource,
  DurationMode,
  ExtraFolder,
  FolderAugmentation,
};

export type { ModelPaths };

export type AppModelDefaults = Record<string, ModelPaths>;

export type FormState = TrainingFormValues;

/**
 * A form section. Same set as the field registry's groups — aliased rather than
 * redeclared so the two can't drift.
 */
export type SectionName = ConceptualGroup;

/**
 * Compile-time proof that `FIELD_REGISTRY` and `FormState` describe the same
 * fields. Per-section reset and change detection are both derived from the
 * registry, so a field present in one but not the other would silently opt out
 * of resetting and of the "section has changes" indicator. Either half being
 * non-`never` resolves to `false` here and fails to satisfy `true`.
 */
type Expect<T extends true> = T;
// Deliberately unreferenced — the assertion is the whole point, and exporting
// it just to satisfy the linter would put a meaningless type on the module's
// public surface.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type FieldRegistryCoversFormState = Expect<
  Exclude<keyof FormState, TrainingFieldName> extends never
    ? Exclude<TrainingFieldName, keyof FormState> extends never
      ? true
      : false
    : false
>;

/** Metadata describing the saved project currently loaded into the form. */
export type LoadedProject = {
  id: string;
  name: string;
  version: number;
  versionLabel: string | null;
  savedAt: string;
};

export type TrainingConfigState = {
  form: FormState;
  appModelDefaults: AppModelDefaults;
  /** Metadata about which saved project/version is loaded, if any. */
  loadedProject: LoadedProject | null;
  /**
   * Snapshot of the form at load/save time. Compared against `form` to
   * compute the dirty flag. Null when ephemeral (nothing to compare against).
   */
  baselineSnapshot: FormState | null;
};
