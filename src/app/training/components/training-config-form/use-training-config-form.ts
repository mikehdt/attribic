import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  ModelComponentType,
  ModelDefinition,
} from '@/app/services/training/models';
import { resolveLoraOutputDir } from '@/app/services/training/output-path';
import type { TrainingProvider } from '@/app/services/training/types';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import {
  addDataset as addDatasetAction,
  addExtraFolder as addExtraFolderAction,
  addSamplePrompt as addSamplePromptAction,
  applyAppDefaults,
  removeDataset as removeDatasetAction,
  removeExtraFolder as removeExtraFolderAction,
  removeSamplePrompt as removeSamplePromptAction,
  resetAll as resetAllAction,
  resetSection as resetSectionAction,
  selectAppModelDefaults,
  selectCalculatedEpochs,
  selectCalculatedSteps,
  selectCurrentModel,
  selectDatasetStats,
  selectForm,
  selectModelDefaults,
  selectSectionHasChanges,
  setAppModelDefaults as setAppModelDefaultsAction,
  setField as setFieldAction,
  setFolderRepeats as setFolderRepeatsAction,
  setModel as setModelAction,
  setModelPath as setModelPathAction,
  setProvider as setProviderAction,
  setSamplePrompt as setSamplePromptAction,
  updateFolderAugment as updateFolderAugmentAction,
} from '@/app/store/training-config';
import { defaultFolderAugmentation } from '@/app/store/training-config/defaults';
import type {
  AppModelDefaults,
  DatasetFolder,
  DatasetSource,
  DurationMode,
  ExtraFolder,
  FolderAugmentation,
  FolderAugmentKey,
  FormState,
  ModelPaths,
  SectionName,
} from '@/app/store/training-config/types';

// Re-exports for backwards compatibility with existing consumers.
export { defaultFolderAugmentation };
export type {
  AppModelDefaults,
  DatasetFolder,
  DatasetSource,
  DurationMode,
  ExtraFolder,
  FolderAugmentation,
  FolderAugmentKey,
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
  const datasetStats = useAppSelector(selectDatasetStats);
  const calculatedSteps = useAppSelector(selectCalculatedSteps);
  const calculatedEpochs = useAppSelector(selectCalculatedEpochs);
  const sectionHasChanges = useAppSelector(selectSectionHasChanges);

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

  // Apply app defaults when model changes or defaults are first loaded.
  useEffect(() => {
    if (!currentModel) return;
    const modelDefaults = appModelDefaults[state.modelId];
    if (modelDefaults && Object.keys(modelDefaults).length > 0) {
      dispatch(applyAppDefaults(modelDefaults));
    }
  }, [state.modelId, appModelDefaults, currentModel, dispatch]);

  const setField = useCallback(
    <K extends keyof FormState>(field: K, value: FormState[K]) => {
      dispatch(setFieldAction({ field, value }));
    },
    [dispatch],
  );

  const setModel = useCallback(
    (modelId: string) => {
      dispatch(setModelAction(modelId));
    },
    [dispatch],
  );

  const setProvider = useCallback(
    (provider: TrainingProvider) => {
      dispatch(setProviderAction(provider));
    },
    [dispatch],
  );

  const setModelPath = useCallback(
    (component: ModelComponentType, path: string) => {
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
    (
      folderName: string,
      displayName: string,
      folders: Omit<DatasetFolder, keyof FolderAugmentation>[],
      thumbnail?: string,
      thumbnailVersion?: number,
      dimensionHistogram?: Record<string, number>,
    ) => {
      dispatch(
        addDatasetAction({
          folderName,
          displayName,
          folders,
          thumbnail,
          thumbnailVersion,
          dimensionHistogram,
        }),
      );
    },
    [dispatch],
  );

  const removeDataset = useCallback(
    (index: number) => {
      dispatch(removeDatasetAction(index));
    },
    [dispatch],
  );

  const setFolderRepeats = useCallback(
    (
      datasetIndex: number | null,
      folderName: string,
      repeats: number | null,
    ) => {
      dispatch(
        setFolderRepeatsAction({ datasetIndex, folderName, repeats }),
      );
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
    calculatedSteps,
    calculatedEpochs,
    sectionHasChanges,
    setField,
    setModel,
    setProvider,
    setModelPath,
    resetSection,
    resetAll,
    addDataset,
    removeDataset,
    setFolderRepeats,
    updateFolderAugment,
    addExtraFolder,
    removeExtraFolder,
    addSamplePrompt,
    removeSamplePrompt,
    setSamplePrompt,
    setAppModelDefaults,
    outputFolder,
  };
}
