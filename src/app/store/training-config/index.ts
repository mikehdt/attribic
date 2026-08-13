/**
 * Training config slice.
 *
 * Holds the training form state (what the user is currently editing),
 * the loaded saved-project metadata (if any), and the baseline snapshot
 * used to compute the dirty flag.
 */

import {
  createSelector,
  createSlice,
  type PayloadAction,
} from '@reduxjs/toolkit';

import { bucketedStepsPerEpoch } from '@/app/services/training/bucket-steps';
import {
  type CaptionEmission,
  isEmissionChoosable,
} from '@/app/services/training/caption-emission';
import { valuesDiffer } from '@/app/services/training/field-compare';
import {
  getSectionFields,
  type TrainingFieldName,
} from '@/app/services/training/field-registry';
import {
  isModelConfigured,
  normalizePathKey,
  resolveInstalledPath,
} from '@/app/services/training/model-configured';
import {
  ADAPTIVE_OPTIMIZERS,
  getAllModelComponents,
  getModelById,
  isOptimizerSupported,
  MODEL_DEFINITIONS,
  type ModelComponentType,
} from '@/app/services/training/models';
import {
  defaultSampleAspect,
  getSampleBase,
  type SampleAspect,
} from '@/app/services/training/sample-sizes';
import type { TrainingProvider } from '@/app/services/training/types';
import type { CaptionMode } from '@/app/store/project/types';
import { parseSubfolder } from '@/app/utils/subfolder-utils';

import type { RootState } from '../index';
import {
  defaultFolderAugmentation,
  defaultsToFormState,
  getDefaults,
  initialFormState,
} from './defaults';
import type {
  AppModelDefaults,
  DatasetFolder,
  DurationMode,
  FolderAugmentation,
  FormState,
  LoadedProject,
  ModelPaths,
  SectionName,
  TrainingConfigState,
} from './types';

/**
 * The shape a newly added sample prompt starts at. Derived from the form's own
 * resolution settings so a forced `WxH` run keeps defaulting to its training
 * crop, while everything else defaults to square.
 */
const formSampleAspect = (form: FormState): SampleAspect =>
  defaultSampleAspect(getSampleBase(form.resolution, form.nativeResolution));

/**
 * Fields a section owns in the UI but that per-section reset deliberately
 * leaves alone. These identify the run rather than configure it — silently
 * swapping the base model, backend, output name or attached datasets out from
 * under someone who asked to reset a section's *settings* would be a much
 * bigger action than the button advertises. (`datasets`/`extraFolders` are
 * additionally handled by the bespoke augmentation merge in `resetSection`.)
 */
const RESET_EXEMPT_FIELDS = new Set<TrainingFieldName>([
  'modelId',
  'selectedProvider',
  'outputName',
  'datasets',
  'extraFolders',
]);

/**
 * Fields excluded from change detection. `networkDimAlphaLinked` is a UI
 * preference for whether the dim and alpha inputs move together — it changes
 * nothing about the run, so it must not light up the section's change dot.
 * The identity fields above are likewise not "settings that differ from the
 * baseline"; dataset augmentation has its own comparison.
 */
const CHANGE_EXEMPT_FIELDS = new Set<TrainingFieldName>([
  ...RESET_EXEMPT_FIELDS,
  'networkDimAlphaLinked',
  'modelPaths',
]);

/**
 * Copy a section's registry fields from `ref` onto `form`. Arrays are cloned
 * so the two forms don't end up sharing a reference — `ref` is frequently the
 * baseline snapshot, which must stay independent of subsequent edits.
 */
function copySectionFields(
  form: FormState,
  ref: FormState,
  section: SectionName,
): void {
  for (const field of getSectionFields(section)) {
    if (RESET_EXEMPT_FIELDS.has(field)) continue;
    const value = ref[field];
    (form as Record<string, unknown>)[field] = Array.isArray(value)
      ? [...value]
      : value;
  }
}

/** Whether any of a section's comparable fields differ between two forms. */
function sectionFieldsDiffer(
  form: FormState,
  ref: FormState,
  section: SectionName,
): boolean {
  return getSectionFields(section).some(
    (field) =>
      !CHANGE_EXEMPT_FIELDS.has(field) && valuesDiffer(form[field], ref[field]),
  );
}

/** Images the run sees per epoch, before and after per-folder repeats. */
function datasetTotals(form: FormState) {
  let totalImages = 0;
  let totalEffective = 0;
  for (const ds of form.datasets) {
    for (const folder of ds.folders) {
      const repeats = folder.overrideRepeats ?? folder.detectedRepeats;
      if (repeats === 0) continue;
      totalImages += folder.imageCount;
      totalEffective += folder.imageCount * repeats;
    }
  }
  return { totalImages, totalEffective };
}

/**
 * Steps in one epoch — the conversion factor behind every epochs↔steps readout
 * in the form. Not `images / batch`: the trainers batch within aspect-ratio
 * buckets, so each bucket rounds its own partial batch up to a whole step. See
 * `services/training/bucket-steps` for the maths and why the difference is
 * worth modelling (25% on a 15-image dataset, and it compounds over a run).
 */
function stepsPerEpoch(form: FormState): number {
  return bucketedStepsPerEpoch({
    folders: form.datasets.flatMap((ds) =>
      ds.folders.map((folder) => ({
        histogram: ds.folderHistograms?.[folder.name],
        effectiveImages:
          folder.imageCount *
          (folder.overrideRepeats ?? folder.detectedRepeats),
      })),
    ),
    batchSize: form.batchSize,
    resolution: form.resolution,
    nativeResolution: form.nativeResolution,
    bucketResoSteps: form.bucketResoSteps,
    bucketNoUpscale: form.bucketNoUpscale,
  });
}

/**
 * The three epochs/steps toggles — Duration, Generate Every, Save Every —
 * each pick their own unit. Mixing them is a legitimate choice, not an
 * accident: a long epoch is exactly when you'd train for n epochs but sample
 * every 200 steps, a cadence that isn't a whole number of epochs at all.
 */
const CADENCE_PAIRS = [
  { mode: 'durationMode', epochs: 'epochs', steps: 'steps' },
  {
    mode: 'sampleMode',
    epochs: 'sampleEveryEpochs',
    steps: 'sampleEverySteps',
  },
  { mode: 'saveMode', epochs: 'saveEveryEpochs', steps: 'saveEverySteps' },
] as const;

type CadencePair = (typeof CADENCE_PAIRS)[number];

const findCadencePair = (field: string): CadencePair | undefined =>
  CADENCE_PAIRS.find((pair) => pair.mode === field);

/**
 * Switch one cadence's unit, carrying its number across rather than revealing
 * whatever was last parked in the other unit. Without this, "sample every 2
 * epochs" becomes the model's default step cadence the moment you touch the
 * toggle — same control, a completely different run.
 *
 * Conversion mirrors the epochs↔steps maths the Duration readout already
 * shows. It rounds, since a step cadence rarely lands on a whole epoch, but
 * both directions floor to at least 1: a cadence of 0 means "never" to the
 * backends, which is a silent way to turn sampling or saving off.
 *
 * With no dataset attached there's no steps-per-epoch to convert through, so
 * the stored values are left alone and only the unit changes.
 */
function switchCadenceUnit(
  form: FormState,
  pair: CadencePair,
  next: DurationMode,
) {
  const perEpoch = stepsPerEpoch(form);
  const canConvert = perEpoch > 0 && form[pair.mode] !== next;

  if (canConvert) {
    if (next === 'steps') {
      form[pair.steps] = Math.max(1, form[pair.epochs] * perEpoch);
    } else {
      form[pair.epochs] = Math.max(1, Math.floor(form[pair.steps] / perEpoch));
    }
  }

  form[pair.mode] = next;
}

const initialState: TrainingConfigState = {
  form: initialFormState(),
  appModelDefaults: {},
  loadedProject: null,
  baselineSnapshot: null,
};

/**
 * Initial slice state seeded with a specific model — used by the store
 * factory to start the form on the user's last-chosen model (from the
 * cookie-seeded preferences) on both server and client, so the first
 * render is already correct instead of flipping post-mount. Falls back
 * to the standard initial state when the id is missing or stale.
 */
export function makeTrainingConfigState(
  modelId?: string | null,
): TrainingConfigState {
  const valid = modelId && getModelById(modelId) ? modelId : null;
  return {
    ...initialState,
    form: valid
      ? defaultsToFormState(getDefaults(valid), valid)
      : initialFormState(),
  };
}

const trainingConfigSlice = createSlice({
  name: 'trainingConfig',
  initialState,
  reducers: {
    setField: <K extends keyof FormState>(
      state: TrainingConfigState,
      action: PayloadAction<{ field: K; value: FormState[K] }>,
    ) => {
      const field = action.payload.field as string;

      // An epochs/steps toggle converts its own value on the way across.
      const cadence = findCadencePair(field);
      if (cadence) {
        switchCadenceUnit(
          state.form,
          cadence,
          action.payload.value as DurationMode,
        );
        return;
      }

      // Cast through unknown — the generic narrowing isn't preserved when
      // RTK infers action types, but the runtime assignment is safe.
      (state.form as Record<string, unknown>)[field] = action.payload
        .value as unknown;
    },

    /**
     * Switch the optimiser, coupled with a learning-rate safety adjustment.
     * Prodigy/DAdaptation are self-tuning and expect an LR near 1.0, while
     * every other optimiser wants ~1e-4 — the two scales don't overlap, so
     * carrying a value across the boundary always misrepresents the run.
     *
     * The threshold (0.1) is the backends' own: ai-toolkit's `get_optimizer`
     * forces anything below it to 1.0 for these optimisers, and kohya warns.
     * Matching it means the form shows what will actually train, rather than
     * only correcting the untouched-default case (which left a nudged LR of,
     * say, 2e-4 sitting under Prodigy, silently overridden at launch).
     */
    setOptimizer: (state, action: PayloadAction<string>) => {
      const nextOptimizer = action.payload;
      const wasAdaptive = ADAPTIVE_OPTIMIZERS.has(state.form.optimizer);
      const isAdaptive = ADAPTIVE_OPTIMIZERS.has(nextOptimizer);
      const modelDefaultLR = getDefaults(state.form.modelId).learningRate;

      if (isAdaptive && !wasAdaptive && state.form.learningRate < 0.1) {
        state.form.learningRate = 1.0;
      } else if (!isAdaptive && wasAdaptive && state.form.learningRate >= 0.1) {
        state.form.learningRate = modelDefaultLR;
      }

      state.form.optimizer = nextOptimizer;
    },

    setModel: (state, action: PayloadAction<string>) => {
      const modelId = action.payload;
      const defaults = getDefaults(modelId);
      const nextModel = getModelById(modelId);
      const preserveMock =
        state.form.selectedProvider === 'mock' &&
        nextModel?.providers.includes('mock');

      // Preserve user's dataset and output choices across model switches.
      const preserved = {
        outputName: state.form.outputName,
        datasets: state.form.datasets,
        extraFolders: state.form.extraFolders,
        samplePrompts: state.form.samplePrompts,
        samplePromptSizes: state.form.samplePromptSizes,
      };

      state.form = {
        ...defaultsToFormState(defaults, modelId),
        selectedProvider: preserveMock
          ? 'mock'
          : (nextModel?.providers[0] ?? 'ai-toolkit'),
        ...preserved,
      };
      fillEmptyModelPaths(state.form, state.appModelDefaults[modelId]);
    },

    /**
     * Switch the backend, dropping an optimiser the new one can't run back to
     * the model's default. Both trainers resolve the optimiser by name at
     * startup and raise when its package is missing (Lion is a kohya
     * dependency, Automagic is ai-toolkit's own), so leaving a stale value
     * would only surface as a run that dies seconds after launch.
     */
    setProvider: (state, action: PayloadAction<TrainingProvider>) => {
      const provider = action.payload;
      state.form.selectedProvider = provider;
      if (!isOptimizerSupported(state.form.optimizer, provider)) {
        state.form.optimizer = getDefaults(state.form.modelId).optimizer;
      }
    },

    setModelPath: (
      state,
      action: PayloadAction<{ component: ModelComponentType; path: string }>,
    ) => {
      state.form.modelPaths[action.payload.component] = action.payload.path;
    },

    applyAppDefaults: (state, action: PayloadAction<ModelPaths>) => {
      fillEmptyModelPaths(state.form, action.payload);
    },

    /**
     * Drop any component path pointing at one of these (now deleted) files.
     * Keeps the form honest after a model is uninstalled — a path to bytes
     * that aren't there would otherwise still read as a configured model.
     */
    forgetModelPaths: (state, action: PayloadAction<string[]>) => {
      const gone = new Set(action.payload.map(normalizePathKey));
      for (const [component, path] of Object.entries(state.form.modelPaths)) {
        if (path && gone.has(normalizePathKey(path))) {
          state.form.modelPaths[component as ModelComponentType] = '';
        }
      }
    },

    resetSection: (state, action: PayloadAction<SectionName>) => {
      // Reset target depends on whether a project is loaded:
      //   - Loaded: revert this section's fields to the baseline snapshot,
      //     so per-section reset matches the loaded version rather than
      //     the model's generic defaults.
      //   - Ephemeral: fall back to suggested defaults for the model.
      const ref =
        state.baselineSnapshot ??
        pristineFormState(state.form.modelId, state.appModelDefaults);
      const { form } = state;

      // Datasets carry per-folder augmentation that has to be matched up by
      // folder rather than copied wholesale — handled below. Every other
      // section is a flat copy of its registry fields.
      if (action.payload !== 'dataset') {
        copySectionFields(form, ref, action.payload);
        return;
      }

      {
        // For each folder in the current form, apply baseline augments
        // when the folder exists in the reference; otherwise apply the
        // model's default augments. Datasets/folders themselves aren't
        // added or removed by section reset.
        const fallback = defaultFolderAugmentation(
          getDefaults(state.form.modelId),
        );
        const refFolderMap = new Map<string, FolderAugmentation>();
        for (const ds of ref.datasets) {
          for (const f of ds.folders) {
            refFolderMap.set(`${ds.folderName}/${f.name}`, extractAugment(f));
          }
        }
        const refExtraMap = new Map<string, FolderAugmentation>();
        for (const ef of ref.extraFolders) {
          refExtraMap.set(ef.path, extractAugment(ef));
        }
        for (const ds of form.datasets) {
          for (const f of ds.folders) {
            const key = `${ds.folderName}/${f.name}`;
            Object.assign(f, refFolderMap.get(key) ?? fallback);
          }
        }
        for (const ef of form.extraFolders) {
          Object.assign(ef, refExtraMap.get(ef.path) ?? fallback);
        }
      }
    },

    resetAll: (state) => {
      state.form = pristineFormState(
        state.form.modelId,
        state.appModelDefaults,
      );
    },

    /** Revert the form to suggested defaults AND drop any loaded project. */
    resetToSuggestedDefaults: (state) => {
      state.form = pristineFormState(
        state.form.modelId,
        state.appModelDefaults,
      );
      state.loadedProject = null;
      state.baselineSnapshot = null;
    },

    /** Revert the form to the currently loaded version's baseline. */
    revertToBaseline: (state) => {
      if (state.baselineSnapshot) {
        state.form = state.baselineSnapshot;
      }
    },

    // samplePrompts and samplePromptSizes are index-aligned, so every mutation
    // here moves both in lockstep — a size array that drifts out of step would
    // silently give a prompt someone else's shape.
    addSamplePrompt: (state) => {
      state.form.samplePrompts.push('');
      state.form.samplePromptSizes.push(formSampleAspect(state.form));
    },

    removeSamplePrompt: (state, action: PayloadAction<number>) => {
      const next = state.form.samplePrompts.filter(
        (_, i) => i !== action.payload,
      );
      const nextSizes = state.form.samplePromptSizes.filter(
        (_, i) => i !== action.payload,
      );
      state.form.samplePrompts = next.length === 0 ? [''] : next;
      state.form.samplePromptSizes =
        next.length === 0 ? [formSampleAspect(state.form)] : nextSizes;
    },

    setSamplePrompt: (
      state,
      action: PayloadAction<{ index: number; value: string }>,
    ) => {
      state.form.samplePrompts[action.payload.index] = action.payload.value;
    },

    setSamplePromptSize: (
      state,
      action: PayloadAction<{ index: number; value: SampleAspect }>,
    ) => {
      const { index, value } = action.payload;
      // Configs saved before per-prompt sizes existed load with a short array;
      // pad it out so writing to a later index doesn't leave holes.
      const sizes = state.form.samplePromptSizes;
      while (sizes.length < state.form.samplePrompts.length) {
        sizes.push(formSampleAspect(state.form));
      }
      sizes[index] = value;
    },

    /**
     * Move a prompt to a new position, its shape travelling with it. Sizes are
     * padded first for the same reason as above — moving within a short array
     * would pair prompts with shapes they were never given.
     */
    reorderSamplePrompts: (
      state,
      action: PayloadAction<{ from: number; to: number }>,
    ) => {
      const { from, to } = action.payload;
      const prompts = state.form.samplePrompts;
      if (from === to) return;
      if (
        from < 0 ||
        to < 0 ||
        from >= prompts.length ||
        to >= prompts.length
      ) {
        return;
      }
      const sizes = state.form.samplePromptSizes;
      while (sizes.length < prompts.length) {
        sizes.push(formSampleAspect(state.form));
      }
      prompts.splice(to, 0, prompts.splice(from, 1)[0]);
      sizes.splice(to, 0, sizes.splice(from, 1)[0]);
    },

    addDataset: (
      state,
      action: PayloadAction<{
        folderName: string;
        displayName: string;
        thumbnail?: boolean;
        thumbnailVersion?: number;
        folderHistograms?: Record<string, Record<string, number>>;
        captionMode?: CaptionMode;
        folders: Omit<DatasetFolder, keyof FolderAugmentation>[];
      }>,
    ) => {
      const baseAugment = defaultFolderAugmentation(
        getDefaults(state.form.modelId),
      );
      state.form.datasets.push({
        projectName: action.payload.displayName,
        folderName: action.payload.folderName,
        thumbnail: action.payload.thumbnail,
        thumbnailVersion: action.payload.thumbnailVersion,
        folderHistograms: action.payload.folderHistograms,
        // Unpinned: follow the model's preference until the user says otherwise.
        captionEmission: null,
        // The picker read these folders off disk moments ago, so record that
        // as the dataset's scan rather than leaving it unread — otherwise the
        // scan-sync effect immediately opens every image header again for a
        // project it already has current numbers for.
        scan: {
          exists: true,
          assetCount: action.payload.folders.reduce(
            (sum, f) => sum + f.imageCount,
            0,
          ),
          captionMode: action.payload.captionMode,
        },
        folders: action.payload.folders.map((f) => ({ ...f, ...baseAugment })),
      });
    },

    /**
     * Replace a dataset's folder list with what a fresh disk scan found.
     *
     * The folders themselves — which exist, how many images each holds, and
     * what repeat count their name declares — are readings of the disk, not
     * config. Only the user's per-folder choices carry across, matched up by
     * name: a folder that's appeared since the last load arrives with the
     * model's default augmentation, and one that's gone drops out entirely
     * rather than lingering as a row describing a directory that isn't there.
     *
     * Applied to the baseline snapshot in lockstep with the form. Everything
     * written here is derived, so a rescan must never be what makes a clean
     * project look dirty — and any real edit the user has made survives,
     * because it lives in the fields carried across on both sides.
     *
     * Keyed by folderName rather than index: the scan is async, and datasets
     * can be added or removed while it's in flight.
     */
    reconcileDatasetFolders: (
      state,
      action: PayloadAction<{
        folderName: string;
        exists: boolean;
        captionMode?: CaptionMode;
        folders: Omit<
          DatasetFolder,
          keyof FolderAugmentation | 'overrideRepeats'
        >[];
      }>,
    ) => {
      const { folderName, exists, captionMode, folders } = action.payload;
      const fallback = defaultFolderAugmentation(
        getDefaults(state.form.modelId),
      );

      for (const form of [state.form, state.baselineSnapshot]) {
        const dataset = form?.datasets.find((d) => d.folderName === folderName);
        if (!dataset) continue;

        const previous = new Map(dataset.folders.map((f) => [f.name, f]));
        dataset.folders = folders.map((scanned) => {
          const existing = previous.get(scanned.name);
          return {
            ...scanned,
            overrideRepeats: existing?.overrideRepeats ?? null,
            ...(existing ? extractAugment(existing) : fallback),
          };
        });
        dataset.scan = {
          exists,
          assetCount: folders.reduce((sum, f) => sum + f.imageCount, 0),
          captionMode,
        };

        // A pin describes a choice between the two halves of a hybrid caption.
        // Retag the project to a single-caption mode and that choice no longer
        // exists, so the pin can only be wrong — drop it and let the file's own
        // content stand. Cleared on the baseline too, so a rescan that finds a
        // retagged project doesn't read as an unsaved edit.
        if (captionMode !== undefined && !isEmissionChoosable(captionMode)) {
          dataset.captionEmission = null;
        }
      }
    },

    /**
     * Record a dataset's image-size histogram from a fresh disk scan. Split
     * from the folder reconcile above because it costs a header read per image
     * where that costs one directory listing — the form renders on the folders
     * and fills in the bucket preview when this lands.
     */
    setDatasetHistogram: (
      state,
      action: PayloadAction<{
        folderName: string;
        folderHistograms: Record<string, Record<string, number>>;
      }>,
    ) => {
      const { folderName, folderHistograms } = action.payload;
      for (const form of [state.form, state.baselineSnapshot]) {
        const dataset = form?.datasets.find((d) => d.folderName === folderName);
        if (!dataset) continue;
        dataset.folderHistograms = folderHistograms;
      }
    },

    removeDataset: (state, action: PayloadAction<number>) => {
      state.form.datasets.splice(action.payload, 1);
    },

    /**
     * Pin which half of a hybrid caption a dataset trains on.
     *
     * `null` means "follow the model's preference" — the control passes it when
     * the user picks the segment that is already the default, so choosing the
     * value the model would have chosen anyway doesn't silently pin it against
     * a later model switch.
     */
    setDatasetCaptionEmission: (
      state,
      action: PayloadAction<{
        index: number;
        emission: CaptionEmission | null;
      }>,
    ) => {
      const dataset = state.form.datasets[action.payload.index];
      if (dataset) dataset.captionEmission = action.payload.emission;
    },

    setFolderRepeats: (
      state,
      action: PayloadAction<{
        datasetIndex: number | null;
        folderName: string;
        repeats: number | null;
      }>,
    ) => {
      const { datasetIndex, folderName, repeats } = action.payload;
      if (datasetIndex === null) {
        const ef = state.form.extraFolders.find((e) => e.path === folderName);
        if (ef) ef.overrideRepeats = repeats;
        return;
      }
      const folder = state.form.datasets[datasetIndex]?.folders.find(
        (f) => f.name === folderName,
      );
      if (folder) folder.overrideRepeats = repeats;
    },

    updateFolderAugment: (
      state,
      action: PayloadAction<{
        datasetIndex: number | null;
        folderName: string;
        updates: Partial<FolderAugmentation>;
      }>,
    ) => {
      const { datasetIndex, folderName, updates } = action.payload;
      if (datasetIndex === null) {
        const ef = state.form.extraFolders.find((e) => e.path === folderName);
        if (ef) Object.assign(ef, updates);
        return;
      }
      const folder = state.form.datasets[datasetIndex]?.folders.find(
        (f) => f.name === folderName,
      );
      if (folder) Object.assign(folder, updates);
    },

    addExtraFolder: (state, action: PayloadAction<string>) => {
      if (state.form.extraFolders.some((ef) => ef.path === action.payload)) {
        return;
      }
      const baseAugment = defaultFolderAugmentation(
        getDefaults(state.form.modelId),
      );
      state.form.extraFolders.push({
        path: action.payload,
        overrideRepeats: null,
        ...baseAugment,
      });
    },

    removeExtraFolder: (state, action: PayloadAction<number>) => {
      state.form.extraFolders.splice(action.payload, 1);
    },

    setAppModelDefaults: (state, action: PayloadAction<AppModelDefaults>) => {
      state.appModelDefaults = action.payload;
    },

    /**
     * Load a saved project version into the form.
     * Replaces current form, records the loaded project metadata,
     * and stamps the baseline so the dirty flag starts clean.
     */
    hydrateFromProject: (
      state,
      action: PayloadAction<{ form: FormState; loadedProject: LoadedProject }>,
    ) => {
      // Saved forms can predate fields added since the save (they load as
      // undefined and would blank dropdowns, warn on controlled inputs, and
      // inflate the hidden-changes badges), so merge over the model's defaults
      // first — saved values win, missing keys get defaults. selectedProvider
      // can also go stale if the model's provider list changed since the save;
      // coerce it back to a supported provider so the run doesn't fail
      // sidecar-side. Baseline mirrors the merged form so dirty stays clean.
      const incoming = action.payload.form;
      const merged: FormState = {
        ...defaultsToFormState(getDefaults(incoming.modelId), incoming.modelId),
        ...incoming,
      };
      const form = normalizeDatasets(coerceProvider(merged));
      state.form = form;
      state.loadedProject = action.payload.loadedProject;
      state.baselineSnapshot = form;
    },

    /**
     * Load a past run's settings into the form. Same merge-over-defaults
     * treatment as {@link hydrateFromProject} — a run archived before a field
     * existed loads it as undefined otherwise. Unlike a saved project this has
     * no disk identity, so the loaded-project pointer is dropped and the
     * baseline left null: the form is ephemeral until the user saves it.
     */
    hydrateFromRun: (state, action: PayloadAction<FormState>) => {
      const incoming = action.payload;
      const merged: FormState = {
        ...defaultsToFormState(getDefaults(incoming.modelId), incoming.modelId),
        ...incoming,
      };
      state.form = normalizeDatasets(coerceProvider(merged));
      state.loadedProject = null;
      state.baselineSnapshot = null;
    },

    /**
     * After a successful save, update the loaded-project pointer and
     * re-stamp the baseline to the current form (dirty → clean).
     */
    stampSaved: (state, action: PayloadAction<LoadedProject>) => {
      state.loadedProject = action.payload;
      state.baselineSnapshot = state.form;
    },

    /** Drop the loaded-project pointer. Form is left untouched. */
    clearLoadedProject: (state) => {
      state.loadedProject = null;
      state.baselineSnapshot = null;
    },
  },
});

export const {
  setField,
  setOptimizer,
  setModel,
  setProvider,
  setModelPath,
  applyAppDefaults,
  forgetModelPaths,
  resetSection,
  resetAll,
  resetToSuggestedDefaults,
  revertToBaseline,
  addSamplePrompt,
  removeSamplePrompt,
  setSamplePrompt,
  setSamplePromptSize,
  reorderSamplePrompts,
  addDataset,
  reconcileDatasetFolders,
  setDatasetHistogram,
  removeDataset,
  setDatasetCaptionEmission,
  setFolderRepeats,
  updateFolderAugment,
  addExtraFolder,
  removeExtraFolder,
  setAppModelDefaults,
  hydrateFromProject,
  hydrateFromRun,
  stampSaved,
  
} = trainingConfigSlice.actions;

export const trainingConfigReducer = trainingConfigSlice.reducer;

// --- Selectors ---

const selectSlice = (state: RootState) => state.trainingConfig;

export const selectForm = (state: RootState) => state.trainingConfig.form;

export const selectLoadedProject = (state: RootState) =>
  state.trainingConfig.loadedProject;

/**
 * The attached datasets alone. Narrower than {@link selectForm} on purpose:
 * the scan-sync effect watches these and must not re-run for every keystroke
 * elsewhere in the form.
 */
export const selectDatasets = (state: RootState) =>
  state.trainingConfig.form.datasets;

export const selectAppModelDefaults = (state: RootState) =>
  state.trainingConfig.appModelDefaults;

export const selectCurrentModel = createSelector(selectForm, (form) =>
  getModelById(form.modelId),
);

export const selectModelDefaults = createSelector(selectForm, (form) =>
  getDefaults(form.modelId),
);

// --- Configured-ness (cross-slice: saved defaults + installed downloads) ---

const selectAllModelStatusesFromRoot = (state: RootState) =>
  state.modelManager.models;

/**
 * IDs of models the training form should offer by default: those where at
 * least one backend has every required component resolvable to a saved
 * default path or an installed download.
 */
export const selectConfiguredModelIds = createSelector(
  selectAppModelDefaults,
  selectAllModelStatusesFromRoot,
  (defaults, statuses) => {
    const ids = new Set<string>();
    for (const model of MODEL_DEFINITIONS) {
      if (isModelConfigured(model, defaults[model.id], statuses)) {
        ids.add(model.id);
      }
    }
    return ids;
  },
);

/**
 * The current model's saved defaults, backfilled with installed-download
 * paths for components that have no saved default — so a freshly downloaded
 * model pre-fills the form without the user ever opening Model Setup.
 */
export const selectEffectiveModelDefaults = createSelector(
  selectCurrentModel,
  selectAppModelDefaults,
  selectAllModelStatusesFromRoot,
  (model, defaults, statuses): ModelPaths => {
    if (!model) return {};
    const effective: ModelPaths = { ...(defaults[model.id] ?? {}) };
    for (const component of getAllModelComponents(model)) {
      if (effective[component.type]?.trim()) continue;
      const installed = resolveInstalledPath(component.downloadId, statuses);
      if (installed) effective[component.type] = installed;
    }
    return effective;
  },
);

export const selectDatasetStats = createSelector(selectForm, datasetTotals);

export type DatasetIssue = {
  projectName: string;
  folderName: string;
  /** `missing` — folder gone; `empty` — folder still there, nothing in it. */
  reason: 'missing' | 'empty';
};

/**
 * Attached datasets with nothing behind them on disk.
 *
 * A config references a folder by name; the images aren't part of it. So a
 * folder that's been moved, renamed, or emptied since the save leaves the form
 * pointing at a dataset it can't actually train on. Left unflagged that
 * surfaces only as an oddly generic bucket list, and the run fails at the
 * sidecar minutes later.
 *
 * Only datasets that have actually been rescanned are considered — a freshly
 * picked one has no scan yet, and its folder was on disk moments ago anyway.
 */
export const selectDatasetIssues = createSelector(selectForm, (form) => {
  const issues: DatasetIssue[] = [];
  for (const dataset of form.datasets) {
    if (!dataset.scan || dataset.scan.assetCount > 0) continue;

    issues.push({
      projectName: dataset.projectName,
      folderName: dataset.folderName,
      reason: dataset.scan.exists ? 'empty' : 'missing',
    });
  }
  return issues;
});

/**
 * Steps one epoch takes — surfaced so the Duration readout can show the
 * conversion factor rather than an images ÷ batch sum that no longer holds.
 */
export const selectStepsPerEpoch = createSelector(selectForm, (form) =>
  stepsPerEpoch(form),
);

export const selectCalculatedSteps = createSelector(
  selectForm,
  selectDatasetStats,
  (form, stats) => {
    if (stats.totalEffective === 0) return 0;
    if (form.durationMode === 'epochs') {
      return stepsPerEpoch(form) * form.epochs;
    }
    return form.steps;
  },
);

export const selectCalculatedEpochs = createSelector(
  selectForm,
  selectDatasetStats,
  (form, stats) => {
    if (stats.totalEffective === 0) return 0;
    if (form.durationMode === 'steps') {
      return Math.floor(form.steps / stepsPerEpoch(form));
    }
    return form.epochs;
  },
);

export const selectSectionHasChanges = createSelector(selectSlice, (slice) => {
  const { form, baselineSnapshot } = slice;
  const isLoaded = baselineSnapshot !== null;
  // Compare against the loaded baseline when present; otherwise against
  // the pristine defaults for the current model.
  const ref =
    baselineSnapshot ??
    defaultsToFormState(getDefaults(form.modelId), form.modelId);

  const refFolderMap = new Map<string, FolderAugmentation>();
  for (const ds of ref.datasets) {
    for (const f of ds.folders) {
      refFolderMap.set(`${ds.folderName}/${f.name}`, extractAugment(f));
    }
  }
  const refExtraMap = new Map<string, FolderAugmentation>();
  for (const ef of ref.extraFolders) {
    refExtraMap.set(ef.path, extractAugment(ef));
  }
  const fallbackAugment = defaultFolderAugmentation(getDefaults(form.modelId));

  const folderChanged = (
    f: FolderAugmentation,
    refAugment: FolderAugmentation,
  ): boolean => !augmentEqual(f, refAugment);

  const anyFolderChanged =
    form.datasets.some((ds) =>
      ds.folders.some((f) => {
        const refAugment =
          refFolderMap.get(`${ds.folderName}/${f.name}`) ?? fallbackAugment;
        return folderChanged(f, refAugment);
      }),
    ) ||
    form.extraFolders.some((ef) => {
      const refAugment = refExtraMap.get(ef.path) ?? fallbackAugment;
      return folderChanged(ef, refAugment);
    });

  return {
    // No `whatToTrain` entry: model and backend selection are the run's
    // identity, not settings that can drift from a baseline, and
    // ModelSelectSection has no reset affordance to wire it to.
    dataset: anyFolderChanged,
    learning: sectionFieldsDiffer(form, ref, 'learning'),
    loraShape: sectionFieldsDiffer(form, ref, 'loraShape'),
    performance: sectionFieldsDiffer(form, ref, 'performance'),
    // Sampling and saving are opt-in for ephemeral configs (no "has changes"
    // indicator when the user just hasn't touched them). Once a project is
    // loaded, any deviation from the baseline does count.
    sampling: isLoaded && sectionFieldsDiffer(form, ref, 'sampling'),
    saving: isLoaded && sectionFieldsDiffer(form, ref, 'saving'),
  };
});

/**
 * Dirty when a saved project is loaded and the form differs from the
 * snapshot captured at load/save time. Ephemeral configs are never "dirty"
 * because there's no baseline to compare against.
 */
export const selectIsDirty = createSelector(
  selectSlice,
  ({ form, baselineSnapshot }) => {
    if (!baselineSnapshot) return false;
    return !formsEqual(form, baselineSnapshot);
  },
);

/**
 * Whether the current form can be reset. Two cases:
 *  - Loaded + dirty: can revert to the loaded version's baseline.
 *  - Ephemeral: can revert to suggested defaults if the form differs from
 *    the pristine default state for the selected model.
 * When loaded + clean, or ephemeral + already-default, the reset button
 * has nothing to do and should be disabled.
 */
export const selectCanReset = createSelector(selectSlice, (slice) => {
  if (slice.baselineSnapshot) {
    return !formsEqual(slice.form, slice.baselineSnapshot);
  }
  const pristine = pristineFormState(
    slice.form.modelId,
    slice.appModelDefaults,
  );
  return !formsEqual(slice.form, pristine);
});

// --- Helpers ---

/**
 * Ensure `form.selectedProvider` is one the current model actually supports,
 * falling back to the model's first (preferred) provider otherwise. Guards
 * against a saved/loaded provider that's gone stale relative to the model.
 */
function coerceProvider(form: FormState): FormState {
  const model = getModelById(form.modelId);
  if (
    model &&
    model.providers.length > 0 &&
    !model.providers.includes(form.selectedProvider)
  ) {
    return { ...form, selectedProvider: model.providers[0] };
  }
  return form;
}

/**
 * Drop everything a form arriving from outside claims about the files on disk,
 * mirroring the `stripDerived` that takes it off on the way out.
 *
 * `detectedRepeats` is recoverable here and now — it's the number prefixed to
 * the folder's own name — but the image counts, sizes and folder listing all
 * genuinely need the disk, so they start empty and `ensureDatasetScans` fills
 * them in. Clearing rather than trusting matters most for the two sources that
 * *can* still carry them: an archived run, whose numbers are as old as the run,
 * and a config saved before the strip existed. Leaving those in place would
 * also mark the dataset as already scanned, so nothing would ever go and check.
 */
function normalizeDatasets(form: FormState): FormState {
  return {
    ...form,
    datasets: form.datasets.map((dataset) => ({
      ...dataset,
      folderHistograms: undefined,
      scan: undefined,
      folders: (dataset.folders ?? []).map((folder) => ({
        ...folder,
        imageCount: 0,
        detectedRepeats: parseSubfolder(folder.name)?.repeatCount ?? 1,
      })),
    })),
  };
}

/** Fill empty model paths from app-level defaults, preserving user edits. */
function fillEmptyModelPaths(form: FormState, paths?: ModelPaths): void {
  if (!paths) return;
  for (const [key, value] of Object.entries(paths)) {
    const component = key as ModelComponentType;
    if (value && !form.modelPaths[component]) {
      form.modelPaths[component] = value;
    }
  }
}

/**
 * The "untouched" form for a model: suggested defaults with app-level default
 * paths applied. App defaults are auto-filled on load (applyAppDefaults), so
 * they must count as pristine — otherwise the reset button lights up on a
 * form the user never touched, and resetting would wipe the configured paths.
 */
function pristineFormState(
  modelId: string,
  appModelDefaults: AppModelDefaults,
): FormState {
  const form = defaultsToFormState(getDefaults(modelId), modelId);
  fillEmptyModelPaths(form, appModelDefaults[modelId]);
  return form;
}

function extractAugment(f: FolderAugmentation): FolderAugmentation {
  return {
    captionShuffling: f.captionShuffling,
    captionDropoutRate: f.captionDropoutRate,
    keepTokens: f.keepTokens,
    flipAugment: f.flipAugment,
    flipVAugment: f.flipVAugment,
    loraWeight: f.loraWeight,
    isRegularization: f.isRegularization,
  };
}

function augmentEqual(a: FolderAugmentation, b: FolderAugmentation): boolean {
  return (
    a.captionShuffling === b.captionShuffling &&
    a.captionDropoutRate === b.captionDropoutRate &&
    a.keepTokens === b.keepTokens &&
    a.flipAugment === b.flipAugment &&
    a.flipVAugment === b.flipVAugment &&
    a.loraWeight === b.loraWeight &&
    a.isRegularization === b.isRegularization
  );
}

function formsEqual(a: FormState, b: FormState): boolean {
  // Cheap pre-check: same reference = clean.
  if (a === b) return true;
  return deepValueEqual(a, b);
}

/**
 * Structural equality that doesn't care about key order (unlike a
 * JSON.stringify comparison, which is key-order sensitive and would flag two
 * otherwise-identical forms as different). Arrays compare by index, plain
 * objects by key set, everything else by ===.
 */
function deepValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    a === null ||
    b === null
  ) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => deepValueEqual(item, b[i]))
    );
  }
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  const bKeys = Object.keys(bRecord);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key) =>
      Object.hasOwn(bRecord, key) && deepValueEqual(aRecord[key], bRecord[key]),
  );
}
