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

import {
  ADAPTIVE_OPTIMIZERS,
  getModelById,
  type ModelComponentType,
} from '@/app/services/training/models';
import type { TrainingProvider } from '@/app/services/training/types';

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
  FolderAugmentation,
  FormState,
  LoadedProject,
  ModelPaths,
  SectionName,
  TrainingConfigState,
} from './types';

const initialState: TrainingConfigState = {
  form: initialFormState(),
  appModelDefaults: {},
  loadedProject: null,
  baselineSnapshot: null,
};

const trainingConfigSlice = createSlice({
  name: 'trainingConfig',
  initialState,
  reducers: {
    setField: <K extends keyof FormState>(
      state: TrainingConfigState,
      action: PayloadAction<{ field: K; value: FormState[K] }>,
    ) => {
      // Cast through unknown — the generic narrowing isn't preserved when
      // RTK infers action types, but the runtime assignment is safe.
      (state.form as Record<string, unknown>)[action.payload.field as string] =
        action.payload.value as unknown;
    },

    /**
     * Switch the optimiser, coupled with a learning-rate safety adjustment.
     * Prodigy/DAdaptation are self-tuning and expect an LR near 1.0 — the
     * form otherwise seeds LR from the model defaults (~1e-4), which is a
     * footgun for these two. We only nudge the LR when it still matches
     * what the "other side" would have left it at, so a value the user
     * deliberately typed is never clobbered.
     */
    setOptimizer: (state, action: PayloadAction<string>) => {
      const nextOptimizer = action.payload;
      const prevOptimizer = state.form.optimizer;
      const wasAdaptive = ADAPTIVE_OPTIMIZERS.has(prevOptimizer);
      const isAdaptive = ADAPTIVE_OPTIMIZERS.has(nextOptimizer);
      const modelDefaultLR = getDefaults(state.form.modelId).learningRate;

      if (
        isAdaptive &&
        !wasAdaptive &&
        state.form.learningRate === modelDefaultLR
      ) {
        state.form.learningRate = 1.0;
      } else if (
        !isAdaptive &&
        wasAdaptive &&
        state.form.learningRate === 1.0
      ) {
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

    setProvider: (state, action: PayloadAction<TrainingProvider>) => {
      state.form.selectedProvider = action.payload;
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

      switch (action.payload) {
        case 'whatToTrain':
          form.modelPaths = { ...ref.modelPaths };
          break;

        case 'dataset': {
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
          break;
        }

        case 'learning':
          form.durationMode = ref.durationMode;
          form.epochs = ref.epochs;
          form.steps = ref.steps;
          form.batchSize = ref.batchSize;
          form.learningRate = ref.learningRate;
          form.optimizer = ref.optimizer;
          form.scheduler = ref.scheduler;
          form.warmupSteps = ref.warmupSteps;
          form.numRestarts = ref.numRestarts;
          form.weightDecay = ref.weightDecay;
          form.maxGradNorm = ref.maxGradNorm;
          form.trainTextEncoder = ref.trainTextEncoder;
          form.backboneLR = ref.backboneLR;
          form.textEncoderLR = ref.textEncoderLR;
          form.ema = ref.ema;
          form.lossType = ref.lossType;
          form.timestepType = ref.timestepType;
          form.timestepBias = ref.timestepBias;
          form.discreteFlowShift = ref.discreteFlowShift;
          form.minSnrGamma = ref.minSnrGamma;
          form.noiseOffset = ref.noiseOffset;
          form.emaDecay = ref.emaDecay;
          form.seed = ref.seed;
          form.optimizerArgs = ref.optimizerArgs;
          form.contentOrStyle = ref.contentOrStyle;
          form.diffOutputPreservation = ref.diffOutputPreservation;
          form.diffOutputPreservationMultiplier =
            ref.diffOutputPreservationMultiplier;
          form.diffOutputPreservationClass = ref.diffOutputPreservationClass;
          break;

        case 'loraShape':
          form.networkType = ref.networkType;
          form.networkDim = ref.networkDim;
          form.networkAlpha = ref.networkAlpha;
          form.networkDimAlphaLinked = ref.networkDimAlphaLinked;
          form.networkDropout = ref.networkDropout;
          form.scaleWeightNorms = ref.scaleWeightNorms;
          form.networkArgs = ref.networkArgs;
          form.lokrFactor = ref.lokrFactor;
          form.layerTargeting = ref.layerTargeting;
          break;

        case 'performance':
          form.resolution = [...ref.resolution];
          form.mixedPrecision = ref.mixedPrecision;
          form.transformerQuantization = ref.transformerQuantization;
          form.textEncoderQuantization = ref.textEncoderQuantization;
          form.cacheTextEmbeddings = ref.cacheTextEmbeddings;
          form.unloadTextEncoder = ref.unloadTextEncoder;
          form.gradientAccumulationSteps = ref.gradientAccumulationSteps;
          form.gradientCheckpointing = ref.gradientCheckpointing;
          form.cacheLatents = ref.cacheLatents;
          form.bucketResoSteps = ref.bucketResoSteps;
          form.bucketNoUpscale = ref.bucketNoUpscale;
          form.nativeResolution = ref.nativeResolution;
          form.blocksToSwap = ref.blocksToSwap;
          form.lowVram = ref.lowVram;
          break;

        case 'sampling':
          form.samplingEnabled = ref.samplingEnabled;
          form.samplePrompts = [...ref.samplePrompts];
          form.sampleMode = ref.sampleMode;
          form.sampleEveryEpochs = ref.sampleEveryEpochs;
          form.sampleEverySteps = ref.sampleEverySteps;
          form.sampleSteps = ref.sampleSteps;
          form.guidanceScale = ref.guidanceScale;
          form.sampleSampler = ref.sampleSampler;
          break;

        case 'saving':
          form.saveEnabled = ref.saveEnabled;
          form.saveMode = ref.saveMode;
          form.saveEveryEpochs = ref.saveEveryEpochs;
          form.saveEverySteps = ref.saveEverySteps;
          form.saveFormat = ref.saveFormat;
          form.maxSavesToKeep = ref.maxSavesToKeep;
          form.saveState = ref.saveState;
          form.resumeState = ref.resumeState;
          break;
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

    addSamplePrompt: (state) => {
      state.form.samplePrompts.push('');
    },

    removeSamplePrompt: (state, action: PayloadAction<number>) => {
      const next = state.form.samplePrompts.filter(
        (_, i) => i !== action.payload,
      );
      state.form.samplePrompts = next.length === 0 ? [''] : next;
    },

    setSamplePrompt: (
      state,
      action: PayloadAction<{ index: number; value: string }>,
    ) => {
      state.form.samplePrompts[action.payload.index] = action.payload.value;
    },

    addDataset: (
      state,
      action: PayloadAction<{
        folderName: string;
        displayName: string;
        thumbnail?: boolean;
        thumbnailVersion?: number;
        dimensionHistogram?: Record<string, number>;
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
        dimensionHistogram: action.payload.dimensionHistogram,
        folders: action.payload.folders.map((f) => ({ ...f, ...baseAugment })),
      });
    },

    /**
     * Refresh a dataset's dimension histogram from a fresh disk scan.
     *
     * The histogram is derived from the files on disk, not user config — it's
     * deliberately not persisted (see `writeVersion`) and a rescan must never
     * make a clean project look dirty. So the baseline snapshot is updated in
     * lockstep with the form, keeping it out of the dirty comparison entirely.
     *
     * Keyed by folderName rather than index: the scan is async, and datasets
     * can be added or removed while it's in flight.
     */
    setDatasetHistogram: (
      state,
      action: PayloadAction<{
        folderName: string;
        dimensionHistogram: Record<string, number>;
      }>,
    ) => {
      const { folderName, dimensionHistogram } = action.payload;
      for (const form of [state.form, state.baselineSnapshot]) {
        const dataset = form?.datasets.find((d) => d.folderName === folderName);
        if (dataset) dataset.dimensionHistogram = dimensionHistogram;
      }
    },

    removeDataset: (state, action: PayloadAction<number>) => {
      state.form.datasets.splice(action.payload, 1);
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
      const form = coerceProvider(merged);
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
      state.form = coerceProvider(merged);
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
  resetSection,
  resetAll,
  resetToSuggestedDefaults,
  revertToBaseline,
  addSamplePrompt,
  removeSamplePrompt,
  setSamplePrompt,
  addDataset,
  setDatasetHistogram,
  removeDataset,
  setFolderRepeats,
  updateFolderAugment,
  addExtraFolder,
  removeExtraFolder,
  setAppModelDefaults,
  hydrateFromProject,
  hydrateFromRun,
  stampSaved,
  clearLoadedProject,
} = trainingConfigSlice.actions;

export const trainingConfigReducer = trainingConfigSlice.reducer;

// --- Selectors ---

const selectSlice = (state: RootState) => state.trainingConfig;

export const selectForm = (state: RootState) => state.trainingConfig.form;

export const selectLoadedProject = (state: RootState) =>
  state.trainingConfig.loadedProject;

export const selectAppModelDefaults = (state: RootState) =>
  state.trainingConfig.appModelDefaults;

export const selectCurrentModel = createSelector(selectForm, (form) =>
  getModelById(form.modelId),
);

export const selectModelDefaults = createSelector(selectForm, (form) =>
  getDefaults(form.modelId),
);

export const selectDatasetStats = createSelector(selectForm, (form) => {
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
});

export const selectCalculatedSteps = createSelector(
  selectForm,
  selectDatasetStats,
  (form, stats) => {
    if (stats.totalEffective === 0) return 0;
    if (form.durationMode === 'epochs') {
      return Math.ceil((stats.totalEffective * form.epochs) / form.batchSize);
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
      return Math.floor((form.steps * form.batchSize) / stats.totalEffective);
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

  const samplingDiffers =
    form.samplingEnabled !== ref.samplingEnabled ||
    form.sampleMode !== ref.sampleMode ||
    form.sampleEveryEpochs !== ref.sampleEveryEpochs ||
    form.sampleEverySteps !== ref.sampleEverySteps ||
    form.sampleSteps !== ref.sampleSteps ||
    form.guidanceScale !== ref.guidanceScale ||
    form.sampleSampler !== ref.sampleSampler ||
    JSON.stringify(form.samplePrompts) !== JSON.stringify(ref.samplePrompts);

  const savingDiffers =
    form.saveEnabled !== ref.saveEnabled ||
    form.saveMode !== ref.saveMode ||
    form.saveEveryEpochs !== ref.saveEveryEpochs ||
    form.saveEverySteps !== ref.saveEverySteps ||
    form.saveFormat !== ref.saveFormat ||
    form.maxSavesToKeep !== ref.maxSavesToKeep ||
    form.saveState !== ref.saveState ||
    form.resumeState !== ref.resumeState;

  return {
    whatToTrain: false,
    dataset: anyFolderChanged,
    learning:
      form.learningRate !== ref.learningRate ||
      form.optimizer !== ref.optimizer ||
      form.scheduler !== ref.scheduler ||
      form.epochs !== ref.epochs ||
      form.batchSize !== ref.batchSize ||
      form.warmupSteps !== ref.warmupSteps ||
      form.numRestarts !== ref.numRestarts ||
      form.weightDecay !== ref.weightDecay ||
      form.maxGradNorm !== ref.maxGradNorm ||
      form.trainTextEncoder !== ref.trainTextEncoder ||
      form.backboneLR !== ref.backboneLR ||
      form.textEncoderLR !== ref.textEncoderLR ||
      form.ema !== ref.ema ||
      form.lossType !== ref.lossType ||
      form.timestepType !== ref.timestepType ||
      form.timestepBias !== ref.timestepBias ||
      form.discreteFlowShift !== ref.discreteFlowShift ||
      form.minSnrGamma !== ref.minSnrGamma ||
      form.noiseOffset !== ref.noiseOffset ||
      form.emaDecay !== ref.emaDecay ||
      form.seed !== ref.seed ||
      form.optimizerArgs !== ref.optimizerArgs ||
      form.contentOrStyle !== ref.contentOrStyle ||
      form.diffOutputPreservation !== ref.diffOutputPreservation ||
      form.diffOutputPreservationMultiplier !==
        ref.diffOutputPreservationMultiplier ||
      form.diffOutputPreservationClass !== ref.diffOutputPreservationClass,
    loraShape:
      form.networkDim !== ref.networkDim ||
      form.networkAlpha !== ref.networkAlpha ||
      form.networkType !== ref.networkType ||
      form.networkDropout !== ref.networkDropout ||
      form.scaleWeightNorms !== ref.scaleWeightNorms ||
      form.networkArgs !== ref.networkArgs ||
      form.lokrFactor !== ref.lokrFactor ||
      form.layerTargeting !== ref.layerTargeting,
    performance:
      // resolution is an array, so it needs an element-wise compare rather
      // than the `!==` used for the scalar fields below.
      form.resolution.length !== ref.resolution.length ||
      form.resolution.some((r, i) => r !== ref.resolution[i]) ||
      form.mixedPrecision !== ref.mixedPrecision ||
      form.transformerQuantization !== ref.transformerQuantization ||
      form.textEncoderQuantization !== ref.textEncoderQuantization ||
      form.cacheTextEmbeddings !== ref.cacheTextEmbeddings ||
      form.unloadTextEncoder !== ref.unloadTextEncoder ||
      form.gradientAccumulationSteps !== ref.gradientAccumulationSteps ||
      form.gradientCheckpointing !== ref.gradientCheckpointing ||
      form.cacheLatents !== ref.cacheLatents ||
      form.bucketResoSteps !== ref.bucketResoSteps ||
      form.bucketNoUpscale !== ref.bucketNoUpscale ||
      form.nativeResolution !== ref.nativeResolution ||
      form.blocksToSwap !== ref.blocksToSwap ||
      form.lowVram !== ref.lowVram,
    // Sampling and saving are opt-in for ephemeral configs (no "has changes"
    // indicator when the user just hasn't touched them). Once a project is
    // loaded, any deviation from the baseline does count.
    sampling: isLoaded && samplingDiffers,
    saving: isLoaded && savingDiffers,
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
  // Deep equality via JSON serialisation. FormState contains no functions,
  // dates, or circular refs, so this is safe and ~free for a form this size.
  return JSON.stringify(a) === JSON.stringify(b);
}
