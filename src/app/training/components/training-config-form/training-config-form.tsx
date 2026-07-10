import { memo, useCallback, useMemo } from 'react';

import {
  FIELD_REGISTRY,
  getVisibleFields,
} from '@/app/services/training/field-registry';

import { TrainingBottomShelf } from '../bottom-shelf/training-bottom-shelf';
import { ModelDefaultsModal } from '../model-defaults-modal/model-defaults-modal';
import { useModelDefaultsModal } from '../model-defaults-modal/use-model-defaults-modal';
import { DatasetSection } from '../sections/dataset/dataset-section';
import { LearningSection } from '../sections/learning/learning-section';
import { LoraShapeSection } from '../sections/lora-shape-section';
import { ModelSelectSection } from '../sections/model-select-section';
import { PerformanceSection } from '../sections/performance-section';
import { SamplingSection } from '../sections/sampling-section';
import { SavingSection } from '../sections/saving-section';
import { TrainingHistoryModal } from '../training-history-modal/training-history-modal';
import { TrainingSummary } from '../training-summary';
import { useTrainingViewMode } from '../use-training-view-mode';
import {
  type SectionName,
  useTrainingConfigForm,
} from './use-training-config-form';

type TrainingConfigFormProps = {
  onStartTraining?: (config: Record<string, unknown>) => void;
};

const TrainingConfigFormComponent = ({
  onStartTraining,
}: TrainingConfigFormProps) => {
  const viewMode = useTrainingViewMode();

  const {
    state,
    currentModel,
    defaults,
    appModelDefaults,
    datasetStats,
    calculatedSteps,
    calculatedEpochs,
    sectionHasChanges,
    setField,
    setOptimizer,
    setModel,
    setProvider,
    setModelPath,
    resetSection,
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
  } = useTrainingConfigForm();

  const { isOpen: isDefaultsModalOpen, closeModal: closeDefaultsModal } =
    useModelDefaultsModal();

  const visibleFields = useMemo(() => {
    const fields = getVisibleFields(
      viewMode,
      state.modelId,
      state.selectedProvider,
    );
    // Warmup steps are only meaningful for schedulers that use them
    if (state.scheduler === 'constant') fields.delete('warmupSteps');
    // Restarts only apply to cosine_with_restarts
    if (state.scheduler !== 'cosine_with_restarts')
      fields.delete('numRestarts');
    // TE learning rate only applies when training the text encoder
    if (!state.trainTextEncoder) fields.delete('textEncoderLR');
    // EMA decay only applies when EMA is enabled
    if (!state.ema) fields.delete('emaDecay');
    // Bucket controls only matter when multi-resolution bucketing is on
    if (state.resolution.length <= 1) {
      fields.delete('bucketResoSteps');
      fields.delete('bucketNoUpscale');
    }
    // LoKr factor only applies to LoKr networks
    if (state.networkType !== 'lokr') fields.delete('lokrFactor');
    // DOP multiplier/class only apply when DOP is enabled
    if (!state.diffOutputPreservation) {
      fields.delete('diffOutputPreservationMultiplier');
      fields.delete('diffOutputPreservationClass');
    }
    return fields;
  }, [
    viewMode,
    state.modelId,
    state.selectedProvider,
    state.scheduler,
    state.trainTextEncoder,
    state.ema,
    state.resolution,
    state.networkType,
    state.diffOutputPreservation,
  ]);

  // Compute hidden changes per section
  const hiddenChanges = useMemo(() => {
    const perSection: Partial<Record<SectionName, number>> = {};

    for (const [field, meta] of Object.entries(FIELD_REGISTRY)) {
      if (visibleFields.has(field)) continue;
      if (meta.defaultKey === null) continue;

      const currentValue = state[field as keyof typeof state];
      const defaultValue = defaults[meta.defaultKey];

      // Compare values (handle arrays for resolution)
      const isDifferent =
        Array.isArray(currentValue) && Array.isArray(defaultValue)
          ? JSON.stringify(currentValue) !== JSON.stringify(defaultValue)
          : currentValue !== defaultValue;

      if (isDifferent) {
        const section = meta.group as SectionName;
        perSection[section] = (perSection[section] ?? 0) + 1;
      }
    }

    return perSection;
  }, [state, defaults, visibleFields]);

  const handleStart = useCallback(() => {
    const effectiveSteps =
      state.durationMode === 'epochs' ? calculatedSteps : state.steps;

    onStartTraining?.({
      modelId: state.modelId,
      modelPaths: state.modelPaths,
      provider: state.selectedProvider,
      outputName: state.outputName,
      datasets: state.datasets,
      steps: effectiveSteps,
      learningRate: state.learningRate,
      optimizer: state.optimizer,
      scheduler: state.scheduler,
      warmupSteps: state.warmupSteps,
      numRestarts: state.numRestarts,
      weightDecay: state.weightDecay,
      maxGradNorm: state.maxGradNorm,
      trainTextEncoder: state.trainTextEncoder,
      backboneLR: state.backboneLR,
      textEncoderLR: state.textEncoderLR,
      ema: state.ema,
      emaDecay: state.emaDecay,
      lossType: state.lossType,
      timestepType: state.timestepType,
      timestepBias: state.timestepBias,
      discreteFlowShift: state.discreteFlowShift,
      minSnrGamma: state.minSnrGamma,
      noiseOffset: state.noiseOffset,
      batchSize: state.batchSize,
      networkType: state.networkType,
      networkDim: state.networkDim,
      networkAlpha: state.networkAlpha,
      networkDropout: state.networkDropout,
      scaleWeightNorms: state.scaleWeightNorms,
      resolution: state.resolution,
      mixedPrecision: state.mixedPrecision,
      transformerQuantization: state.transformerQuantization,
      textEncoderQuantization: state.textEncoderQuantization,
      cacheTextEmbeddings: state.cacheTextEmbeddings,
      unloadTextEncoder: state.unloadTextEncoder,
      gradientAccumulationSteps: state.gradientAccumulationSteps,
      gradientCheckpointing: state.gradientCheckpointing,
      cacheLatents: state.cacheLatents,
      bucketResoSteps: state.bucketResoSteps,
      bucketNoUpscale: state.bucketNoUpscale,
      extraFolders: state.extraFolders,
      seed: state.seed,
      guidanceScale: state.guidanceScale,
      sampleSteps: state.sampleSteps,
      sampleSampler: state.sampleSampler,
      saveEnabled: state.saveEnabled,
      saveMode: state.saveMode,
      saveEveryEpochs: state.saveEveryEpochs,
      saveEverySteps: state.saveEverySteps,
      saveFormat: state.saveFormat,
      maxSavesToKeep: state.maxSavesToKeep,
      saveState: state.saveState,
      resumeState: state.resumeState,
      networkArgs: state.networkArgs,
      optimizerArgs: state.optimizerArgs,
      blocksToSwap: state.blocksToSwap,
      lokrFactor: state.lokrFactor,
      contentOrStyle: state.contentOrStyle,
      diffOutputPreservation: state.diffOutputPreservation,
      diffOutputPreservationMultiplier: state.diffOutputPreservationMultiplier,
      diffOutputPreservationClass: state.diffOutputPreservationClass,
      layerTargeting: state.layerTargeting,
      lowVram: state.lowVram,
      samplingEnabled: state.samplingEnabled,
      sampleMode: state.sampleMode,
      sampleEveryEpochs: state.sampleEveryEpochs,
      sampleEverySteps: state.sampleEverySteps,
      samplePrompts: state.samplePrompts.map((s) => s.trim()).filter(Boolean),
    });
  }, [state, calculatedSteps, onStartTraining]);

  const hasAllRequiredComponents = currentModel.components
    .filter((c) => c.required)
    .every((c) => state.modelPaths[c.type]?.trim());

  const canStart =
    state.outputName.trim() !== '' &&
    datasetStats.totalImages > 0 &&
    hasAllRequiredComponents;

  return (
    <>
      <div className="mx-auto flex max-w-400 flex-col gap-4 lg:flex-row lg:items-start">
        {/* Settings column */}
        <div className="mr-auto w-full min-w-0 flex-1 space-y-3 lg:max-w-300">
          <ModelSelectSection
            modelId={state.modelId}
            selectedProvider={state.selectedProvider}
            modelPaths={state.modelPaths}
            appModelDefaults={appModelDefaults}
            onModelChange={setModel}
            onProviderChange={setProvider}
            onModelPathChange={setModelPath}
            currentModel={currentModel}
            visibleFields={visibleFields}
            viewMode={viewMode}
            hiddenChangesCount={hiddenChanges.whatToTrain}
          />

          <DatasetSection
            datasets={state.datasets}
            extraFolders={state.extraFolders}
            selectedProvider={state.selectedProvider}
            hasChanges={sectionHasChanges.dataset}
            visibleFields={visibleFields}
            hiddenChangesCount={hiddenChanges.dataset}
            onAddDataset={addDataset}
            onRemoveDataset={removeDataset}
            onSetFolderRepeats={setFolderRepeats}
            onUpdateFolderAugment={updateFolderAugment}
            onAddExtraFolder={addExtraFolder}
            onRemoveExtraFolder={removeExtraFolder}
            onReset={resetSection}
          />

          <LearningSection
            durationMode={state.durationMode}
            epochs={state.epochs}
            steps={state.steps}
            learningRate={state.learningRate}
            optimizer={state.optimizer}
            scheduler={state.scheduler}
            warmupSteps={state.warmupSteps}
            numRestarts={state.numRestarts}
            weightDecay={state.weightDecay}
            maxGradNorm={state.maxGradNorm}
            seed={state.seed}
            trainTextEncoder={state.trainTextEncoder}
            backboneLR={state.backboneLR}
            textEncoderLR={state.textEncoderLR}
            ema={state.ema}
            emaDecay={state.emaDecay}
            lossType={state.lossType}
            timestepType={state.timestepType}
            timestepBias={state.timestepBias}
            discreteFlowShift={state.discreteFlowShift}
            minSnrGamma={state.minSnrGamma}
            noiseOffset={state.noiseOffset}
            optimizerArgs={state.optimizerArgs}
            contentOrStyle={state.contentOrStyle}
            diffOutputPreservation={state.diffOutputPreservation}
            diffOutputPreservationMultiplier={
              state.diffOutputPreservationMultiplier
            }
            diffOutputPreservationClass={state.diffOutputPreservationClass}
            cacheTextEmbeddings={state.cacheTextEmbeddings}
            calculatedSteps={calculatedSteps}
            calculatedEpochs={calculatedEpochs}
            totalEffective={datasetStats.totalEffective}
            batchSize={state.batchSize}
            hasChanges={sectionHasChanges.learning}
            defaults={defaults}
            visibleFields={visibleFields}
            hiddenChangesCount={hiddenChanges.learning}
            viewMode={viewMode}
            onFieldChange={setField}
            onOptimizerChange={setOptimizer}
            onReset={resetSection}
          />

          <LoraShapeSection
            networkType={state.networkType}
            networkDim={state.networkDim}
            networkAlpha={state.networkAlpha}
            networkDimAlphaLinked={state.networkDimAlphaLinked}
            networkDropout={state.networkDropout}
            scaleWeightNorms={state.scaleWeightNorms}
            networkArgs={state.networkArgs}
            lokrFactor={state.lokrFactor}
            layerTargeting={state.layerTargeting}
            hasChanges={sectionHasChanges.loraShape}
            visibleFields={visibleFields}
            hiddenChangesCount={hiddenChanges.loraShape}
            onFieldChange={setField}
            onReset={resetSection}
          />

          <PerformanceSection
            batchSize={state.batchSize}
            resolution={state.resolution}
            availableResolutions={currentModel.availableResolutions}
            provider={state.selectedProvider}
            mixedPrecision={state.mixedPrecision}
            transformerQuantization={state.transformerQuantization}
            textEncoderQuantization={state.textEncoderQuantization}
            cacheTextEmbeddings={state.cacheTextEmbeddings}
            unloadTextEncoder={state.unloadTextEncoder}
            gradientAccumulationSteps={state.gradientAccumulationSteps}
            gradientCheckpointing={state.gradientCheckpointing}
            cacheLatents={state.cacheLatents}
            bucketResoSteps={state.bucketResoSteps}
            bucketNoUpscale={state.bucketNoUpscale}
            blocksToSwap={state.blocksToSwap}
            lowVram={state.lowVram}
            hasChanges={sectionHasChanges.performance}
            visibleFields={visibleFields}
            hiddenChangesCount={hiddenChanges.performance}
            onFieldChange={setField}
            onReset={resetSection}
          />

          <SamplingSection
            samplingEnabled={state.samplingEnabled}
            samplePrompts={state.samplePrompts}
            sampleMode={state.sampleMode}
            sampleEveryEpochs={state.sampleEveryEpochs}
            sampleEverySteps={state.sampleEverySteps}
            sampleSteps={state.sampleSteps}
            guidanceScale={state.guidanceScale}
            sampleSampler={state.sampleSampler}
            visibleFields={visibleFields}
            hiddenChangesCount={hiddenChanges.sampling}
            onFieldChange={setField}
            onAddPrompt={addSamplePrompt}
            onRemovePrompt={removeSamplePrompt}
            onSetPrompt={setSamplePrompt}
            onReset={resetSection}
          />

          <SavingSection
            outputName={state.outputName}
            saveEnabled={state.saveEnabled}
            saveMode={state.saveMode}
            saveEveryEpochs={state.saveEveryEpochs}
            saveEverySteps={state.saveEverySteps}
            saveFormat={state.saveFormat}
            maxSavesToKeep={state.maxSavesToKeep}
            saveState={state.saveState}
            resumeState={state.resumeState}
            visibleFields={visibleFields}
            hiddenChangesCount={hiddenChanges.saving}
            onFieldChange={setField}
            onOutputNameChange={(name) => setField('outputName', name)}
            onReset={resetSection}
          />

          <ModelDefaultsModal
            isOpen={isDefaultsModalOpen}
            onClose={closeDefaultsModal}
            onSaved={setAppModelDefaults}
          />

          <TrainingHistoryModal />
        </div>

        {/* Summary column */}
        <div className="lg:sticky lg:top-24 lg:w-full lg:max-w-60 xl:max-w-100">
          <TrainingSummary
            outputName={state.outputName}
            outputFolder={outputFolder}
            currentModel={currentModel}
            selectedProvider={state.selectedProvider}
            modelPaths={state.modelPaths}
            datasets={state.datasets}
            totalImages={datasetStats.totalImages}
            totalEffective={datasetStats.totalEffective}
            durationMode={state.durationMode}
            epochs={state.epochs}
            steps={state.steps}
            calculatedSteps={calculatedSteps}
            calculatedEpochs={calculatedEpochs}
            batchSize={state.batchSize}
            learningRate={state.learningRate}
            optimizer={state.optimizer}
            scheduler={state.scheduler}
            networkType={state.networkType}
            networkDim={state.networkDim}
            networkAlpha={state.networkAlpha}
            resolution={state.resolution}
            saveEnabled={state.saveEnabled}
            saveMode={state.saveMode}
            saveEveryEpochs={state.saveEveryEpochs}
            saveEverySteps={state.saveEverySteps}
            saveFormat={state.saveFormat}
            seed={state.seed}
          />
        </div>
      </div>

      <TrainingBottomShelf canStart={canStart} onStart={handleStart} />
    </>
  );
};

export const TrainingConfigForm = memo(TrainingConfigFormComponent);
