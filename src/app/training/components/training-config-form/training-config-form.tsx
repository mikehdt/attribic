import { memo, useCallback, useMemo } from 'react';

import { valuesDiffer } from '@/app/services/training/field-compare';
import {
  FIELD_REGISTRY,
  getVisibleFields,
  type TrainingFieldName,
} from '@/app/services/training/field-registry';
import { getModelComponents } from '@/app/services/training/models';
import {
  defaultSampleAspect,
  getSampleBase,
} from '@/app/services/training/sample-sizes';
import type { FormState } from '@/app/store/training-config/types';

import { TrainingBottomShelf } from '../bottom-shelf/training-bottom-shelf';
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
  /**
   * `config` is the flattened launch payload the sidecar expects; `formSnapshot`
   * is the untouched form state, stored on the job so the run's settings can be
   * loaded back later (the flattened payload can't be reversed cleanly).
   */
  onStartTraining?: (
    config: Record<string, unknown>,
    formSnapshot: FormState,
  ) => void;
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
    outputFolder,
  } = useTrainingConfigForm();

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

  // Fields customised away from their model default but not shown at the
  // current tier — surfaced as a per-section "N hidden settings customised"
  // note so the tier isn't hiding edits the run will still act on.
  const hiddenChanges = useMemo(() => {
    const perSection: Partial<Record<SectionName, number>> = {};

    for (const field of Object.keys(FIELD_REGISTRY) as TrainingFieldName[]) {
      const meta = FIELD_REGISTRY[field];
      if (visibleFields.has(field)) continue;
      if (meta.defaultKey === null) continue;

      if (valuesDiffer(state[field], defaults[meta.defaultKey])) {
        perSection[meta.group] = (perSection[meta.group] ?? 0) + 1;
      }
    }

    return perSection;
  }, [state, defaults, visibleFields]);

  const handleStart = useCallback(() => {
    const effectiveSteps =
      state.durationMode === 'epochs' ? calculatedSteps : state.steps;
    // Send the resolved epoch count alongside steps. ai-toolkit is purely
    // step-based, but the sidecar needs the true epoch count to (a) convert
    // epoch-based save cadences to steps and (b) surface an epoch in the
    // progress UI. Mirror effectiveSteps: in steps-mode epochs is derived.
    const effectiveEpochs =
      state.durationMode === 'steps' ? calculatedEpochs : state.epochs;

    // Spread the whole form rather than naming each field: the payload used to
    // be a hand-maintained allowlist, which silently dropped any field added to
    // FormState but forgotten here (nativeResolution went missing that way, so
    // the trainer never saw it). The request builder picks the keys it wants by
    // name, so extra UI-only keys ride along harmlessly.
    // Blank prompt rows are dropped, which shifts the indices — the per-prompt
    // shapes have to be filtered alongside them, not separately.
    const fallbackAspect = defaultSampleAspect(
      getSampleBase(state.resolution, state.nativeResolution),
    );
    const keptPrompts = state.samplePrompts
      .map((text, i) => ({
        text: text.trim(),
        aspect: state.samplePromptSizes[i] ?? fallbackAspect,
      }))
      .filter((p) => p.text !== '');

    onStartTraining?.(
      {
        ...state,
        provider: state.selectedProvider,
        // Which of steps/epochs the user actually asked for. Our epochs→steps
        // conversion is only an estimate (it can't know how the trainer's
        // aspect-ratio buckets round their partial batches), so a backend that
        // can count epochs itself should be told to do that rather than trust
        // the converted step total.
        steps: effectiveSteps,
        epochs: effectiveEpochs,
        samplePrompts: keptPrompts.map((p) => p.text),
        samplePromptSizes: keptPrompts.map((p) => p.aspect),
      },
      state,
    );
  }, [state, calculatedSteps, calculatedEpochs, onStartTraining]);

  const hasAllRequiredComponents = getModelComponents(
    currentModel,
    state.selectedProvider,
  )
    .filter((c) => c.required)
    .every((c) => state.modelPaths[c.type]?.trim());

  // Image counts come from the saved config, so they can outlive the folder
  // they describe — a dataset that failed its disk rescan blocks the run.
  const canStart =
    state.outputName.trim() !== '' &&
    datasetStats.totalImages > 0 &&
    datasetIssues.length === 0 &&
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
            datasetIssues={datasetIssues}
            extraFolders={state.extraFolders}
            selectedProvider={state.selectedProvider}
            modelId={state.modelId}
            viewMode={viewMode}
            hasChanges={sectionHasChanges.dataset}
            visibleFields={visibleFields}
            hiddenChangesCount={hiddenChanges.dataset}
            onAddDataset={addDataset}
            onRemoveDataset={removeDataset}
            onSetCaptionEmission={setDatasetCaptionEmission}
            onRescanDatasets={rescanDatasets}
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
            selectedProvider={state.selectedProvider}
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
            modelName={currentModel.name}
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
            defaults={defaults}
            visibleFields={visibleFields}
            hiddenChangesCount={hiddenChanges.loraShape}
            onFieldChange={setField}
            onReset={resetSection}
          />

          <PerformanceSection
            batchSize={state.batchSize}
            resolution={state.resolution}
            availableResolutions={currentModel.availableResolutions}
            nativeResolution={state.nativeResolution}
            viewMode={viewMode}
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
            defaults={defaults}
            visibleFields={visibleFields}
            hiddenChangesCount={hiddenChanges.performance}
            onFieldChange={setField}
            onReset={resetSection}
          />

          <SamplingSection
            samplingEnabled={state.samplingEnabled}
            samplePrompts={state.samplePrompts}
            samplePromptSizes={state.samplePromptSizes}
            resolution={state.resolution}
            nativeResolution={state.nativeResolution}
            sampleMode={state.sampleMode}
            sampleEveryEpochs={state.sampleEveryEpochs}
            sampleEverySteps={state.sampleEverySteps}
            sampleSteps={state.sampleSteps}
            guidanceScale={state.guidanceScale}
            sampleSampler={state.sampleSampler}
            calculatedSteps={calculatedSteps}
            calculatedEpochs={calculatedEpochs}
            hasChanges={sectionHasChanges.sampling}
            defaults={defaults}
            visibleFields={visibleFields}
            hiddenChangesCount={hiddenChanges.sampling}
            onFieldChange={setField}
            onAddPrompt={addSamplePrompt}
            onRemovePrompt={removeSamplePrompt}
            onSetPrompt={setSamplePrompt}
            onSetPromptSize={setSamplePromptSize}
            onReorderPrompts={reorderSamplePrompts}
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
            hasChanges={sectionHasChanges.saving}
            defaults={defaults}
            visibleFields={visibleFields}
            hiddenChangesCount={hiddenChanges.saving}
            onFieldChange={setField}
            onOutputNameChange={(name) => setField('outputName', name)}
            onReset={resetSection}
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
            datasetIssues={datasetIssues}
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
            nativeResolution={state.nativeResolution}
            saveEnabled={state.saveEnabled}
            saveMode={state.saveMode}
            saveEveryEpochs={state.saveEveryEpochs}
            saveEverySteps={state.saveEverySteps}
            saveFormat={state.saveFormat}
            maxSavesToKeep={state.maxSavesToKeep}
            seed={state.seed}
          />
        </div>
      </div>

      <TrainingBottomShelf canStart={canStart} onStart={handleStart} />
    </>
  );
};

export const TrainingConfigForm = memo(TrainingConfigFormComponent);
