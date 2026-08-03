import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CaptionEmission } from '@/app/services/training/caption-emission';
import {
  getModelById,
  getModelsByArchitecture,
  type ModelComponentType,
  type ModelDefinition,
} from '@/app/services/training/models';
import { resolveLoraOutputDir } from '@/app/services/training/output-path';
import type { SampleAspect } from '@/app/services/training/sample-sizes';
import type { TrainingProvider } from '@/app/services/training/types';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import { selectHasLoadedModelStatuses } from '@/app/store/model-manager';
import {
  selectLastTrainingModelId,
  setLastTrainingModelId,
} from '@/app/store/preferences';
import {
  addDataset as addDatasetAction,
  addExtraFolder as addExtraFolderAction,
  addSamplePrompt as addSamplePromptAction,
  applyAppDefaults,
  removeDataset as removeDatasetAction,
  removeExtraFolder as removeExtraFolderAction,
  removeSamplePrompt as removeSamplePromptAction,
  reorderSamplePrompts as reorderSamplePromptsAction,
  resetAll as resetAllAction,
  resetSection as resetSectionAction,
  selectAppModelDefaults,
  selectCalculatedEpochs,
  selectCalculatedSteps,
  selectConfiguredModelIds,
  selectCurrentModel,
  selectDatasetIssues,
  selectDatasetStats,
  selectEffectiveModelDefaults,
  selectForm,
  selectLoadedProject,
  selectModelDefaults,
  selectSectionHasChanges,
  setAppModelDefaults as setAppModelDefaultsAction,
  setDatasetCaptionEmission as setDatasetCaptionEmissionAction,
  setField as setFieldAction,
  setFolderRepeats as setFolderRepeatsAction,
  setModel as setModelAction,
  setModelPath as setModelPathAction,
  setOptimizer as setOptimizerAction,
  setProvider as setProviderAction,
  setSamplePrompt as setSamplePromptAction,
  setSamplePromptSize as setSamplePromptSizeAction,
  updateFolderAugment as updateFolderAugmentAction,
} from '@/app/store/training-config';
import { refreshDatasetScans } from '@/app/store/training-config/thunks';
import type {
  AppModelDefaults,
  DatasetFolder,
  DatasetSource,
  DurationMode,
  ExtraFolder,
  FolderAugmentation,
  FormState,
  ModelPaths,
  SectionName,
} from '@/app/store/training-config/types';

import type { PickedProject } from '../project-picker/project-picker';

// Convenience re-exports: the section components sit next to this hook and
// read their prop types through it rather than reaching into the store.
export type {
  AppModelDefaults,
  DatasetFolder,
  DatasetSource,
  DurationMode,
  ExtraFolder,
  FolderAugmentation,
  FormState,
  ModelPaths,
  SectionName,
};

export function useTrainingConfigForm() {
  const dispatch = useAppDispatch();

  const state = useAppSelector(selectForm);
  const currentModel = useAppSelector(selectCurrentModel);
  const defaults = useAppSelector(selectModelDefaults);
  const appModelDefaults = useAppSelector(selectAppModelDefaults);
  const effectiveModelDefaults = useAppSelector(selectEffectiveModelDefaults);
  const datasetStats = useAppSelector(selectDatasetStats);
  const datasetIssues = useAppSelector(selectDatasetIssues);
  const calculatedSteps = useAppSelector(selectCalculatedSteps);
  const calculatedEpochs = useAppSelector(selectCalculatedEpochs);
  const sectionHasChanges = useAppSelector(selectSectionHasChanges);
  const lastTrainingModelId = useAppSelector(selectLastTrainingModelId);
  const configuredModelIds = useAppSelector(selectConfiguredModelIds);
  const hasLoadedStatuses = useAppSelector(selectHasLoadedModelStatuses);
  const loadedProject = useAppSelector(selectLoadedProject);

  // One-time fetch of app-level model defaults (paths per architecture).
  useEffect(() => {
    fetch('/api/config/model-defaults')
      .then((r) => r.json())
      .then((data: AppModelDefaults) => {
        dispatch(setAppModelDefaultsAction(data));
      })
      .catch(() => {});
  }, [dispatch]);

  // Configured projects folder — used to show where trained LoRAs land.
  const [projectsFolder, setProjectsFolder] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((data: { projectsFolder?: string }) => {
        setProjectsFolder(data.projectsFolder ?? null);
      })
      .catch(() => {});
  }, []);

  // Absolute directory the LoRA will be written to (mirrors the request
  // builder), or null until the projects folder / a dataset is known.
  const outputFolder = useMemo(
    () => resolveLoraOutputDir(projectsFolder),
    [projectsFolder],
  );

  // Pick a sensible starting model instead of the registry's first entry:
  // the model the user last chose (preference, cookie-seeded), else the
  // first configured one once installed-ness is known. One-shot, and only
  // while the form is untouched — never fights a user or a loaded project.
  const touchedRef = useRef(false);
  const autoPickedRef = useRef(false);
  useEffect(() => {
    if (autoPickedRef.current) return;
    if (touchedRef.current || loadedProject) {
      autoPickedRef.current = true;
      return;
    }
    if (lastTrainingModelId && getModelById(lastTrainingModelId)) {
      autoPickedRef.current = true;
      if (lastTrainingModelId !== state.modelId) {
        dispatch(setModelAction(lastTrainingModelId));
      }
      return;
    }
    // No usable last-choice — wait until statuses are in, then take the
    // first configured model in display order.
    if (!hasLoadedStatuses) return;
    autoPickedRef.current = true;
    const firstConfigured = getModelsByArchitecture()
      .flatMap((group) => group.models)
      .find((model) => configuredModelIds.has(model.id));
    if (firstConfigured && firstConfigured.id !== state.modelId) {
      dispatch(setModelAction(firstConfigured.id));
    }
  }, [
    lastTrainingModelId,
    hasLoadedStatuses,
    configuredModelIds,
    loadedProject,
    state.modelId,
    dispatch,
  ]);

  // Apply effective defaults (saved defaults backfilled with installed
  // downloads) when the model changes or they load/update — so a freshly
  // downloaded model pre-fills without a saved default. Only empty fields
  // are filled; user edits are preserved.
  useEffect(() => {
    if (!currentModel) return;
    if (Object.keys(effectiveModelDefaults).length > 0) {
      dispatch(applyAppDefaults(effectiveModelDefaults));
    }
  }, [state.modelId, effectiveModelDefaults, currentModel, dispatch]);

  const setField = useCallback(
    <K extends keyof FormState>(field: K, value: FormState[K]) => {
      touchedRef.current = true;
      dispatch(setFieldAction({ field, value }));
    },
    [dispatch],
  );

  const setOptimizer = useCallback(
    (optimizer: string) => {
      dispatch(setOptimizerAction(optimizer));
    },
    [dispatch],
  );

  const setModel = useCallback(
    (modelId: string) => {
      touchedRef.current = true;
      dispatch(setModelAction(modelId));
      // Remembered so the next visit reopens on this model. Only explicit
      // dropdown picks count — auto-picks and hydrations don't come through
      // here, so they never overwrite the user's actual choice.
      dispatch(setLastTrainingModelId(modelId));
    },
    [dispatch],
  );

  const setProvider = useCallback(
    (provider: TrainingProvider) => {
      touchedRef.current = true;
      dispatch(setProviderAction(provider));
    },
    [dispatch],
  );

  const setModelPath = useCallback(
    (component: ModelComponentType, path: string) => {
      touchedRef.current = true;
      dispatch(setModelPathAction({ component, path }));
    },
    [dispatch],
  );

  const resetSection = useCallback(
    (section: SectionName) => {
      dispatch(resetSectionAction(section));
    },
    [dispatch],
  );

  const resetAll = useCallback(() => {
    dispatch(resetAllAction());
  }, [dispatch]);

  const addDataset = useCallback(
    (project: PickedProject) => {
      touchedRef.current = true;
      dispatch(addDatasetAction(project));
    },
    [dispatch],
  );

  const setDatasetCaptionEmission = useCallback(
    (index: number, emission: CaptionEmission | null) => {
      dispatch(setDatasetCaptionEmissionAction({ index, emission }));
    },
    [dispatch],
  );

  const removeDataset = useCallback(
    (index: number) => {
      dispatch(removeDatasetAction(index));
    },
    [dispatch],
  );

  const rescanDatasets = useCallback(() => {
    void dispatch(refreshDatasetScans());
  }, [dispatch]);

  const setFolderRepeats = useCallback(
    (
      datasetIndex: number | null,
      folderName: string,
      repeats: number | null,
    ) => {
      dispatch(setFolderRepeatsAction({ datasetIndex, folderName, repeats }));
    },
    [dispatch],
  );

  const updateFolderAugment = useCallback(
    (
      datasetIndex: number | null,
      folderName: string,
      updates: Partial<FolderAugmentation>,
    ) => {
      dispatch(
        updateFolderAugmentAction({ datasetIndex, folderName, updates }),
      );
    },
    [dispatch],
  );

  const addExtraFolder = useCallback(
    (path: string) => {
      dispatch(addExtraFolderAction(path));
    },
    [dispatch],
  );

  const removeExtraFolder = useCallback(
    (index: number) => {
      dispatch(removeExtraFolderAction(index));
    },
    [dispatch],
  );

  const addSamplePrompt = useCallback(() => {
    dispatch(addSamplePromptAction());
  }, [dispatch]);

  const removeSamplePrompt = useCallback(
    (index: number) => {
      dispatch(removeSamplePromptAction(index));
    },
    [dispatch],
  );

  const setSamplePrompt = useCallback(
    (index: number, value: string) => {
      dispatch(setSamplePromptAction({ index, value }));
    },
    [dispatch],
  );

  const setSamplePromptSize = useCallback(
    (index: number, value: SampleAspect) => {
      dispatch(setSamplePromptSizeAction({ index, value }));
    },
    [dispatch],
  );

  const reorderSamplePrompts = useCallback(
    (from: number, to: number) => {
      dispatch(reorderSamplePromptsAction({ from, to }));
    },
    [dispatch],
  );

  const setAppModelDefaults = useCallback(
    (defaults: AppModelDefaults) => {
      dispatch(setAppModelDefaultsAction(defaults));
    },
    [dispatch],
  );

  return {
    state,
    currentModel: currentModel as ModelDefinition,
    defaults,
    appModelDefaults,
    datasetStats,
    datasetIssues,
    calculatedSteps,
    calculatedEpochs,
    sectionHasChanges,
    setField,
    setOptimizer,
    setModel,
    setProvider,
    setModelPath,
    resetSection,
    resetAll,
    addDataset,
    setDatasetCaptionEmission,
    removeDataset,
    rescanDatasets,
    setFolderRepeats,
    updateFolderAugment,
    addExtraFolder,
    removeExtraFolder,
    addSamplePrompt,
    removeSamplePrompt,
    setSamplePrompt,
    setSamplePromptSize,
    reorderSamplePrompts,
    setAppModelDefaults,
    outputFolder,
  };
}
