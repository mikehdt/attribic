import { memo, useCallback, useMemo, useState } from 'react';

import {
  type ExpertiseTier,
  isTierAtLeast,
  type TrainingFieldName,
} from '@/app/services/training/field-registry';
import {
  getMissingProviders,
  getModelComponents,
  getModelsByArchitecture,
  getSelectableProviders,
  hasNoConfiguredProvider,
  type ModelComponentType,
  type ModelDefinition,
} from '@/app/services/training/models';
import {
  TRAINING_PROVIDER_LABELS,
  TRAINING_PROVIDER_SHORT_LABELS,
  type TrainingProvider,
} from '@/app/services/training/types';
import { Checkbox } from '@/app/shared/checkbox';
import { CollapsibleSection } from '@/app/shared/collapsible-section';
import { Dropdown, type DropdownItem } from '@/app/shared/dropdown';
import { FormTitle } from '@/app/shared/form-title/form-title';
import { ModelPathField } from '@/app/shared/model-path-field/model-path-field';
import { useEnsureModelStatuses } from '@/app/shared/model-path-field/use-ensure-model-statuses';
import { useConfiguredBackends } from '@/app/shared/use-configured-backends';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import {
  openModelManagerModal,
  selectHasLoadedModelStatuses,
} from '@/app/store/model-manager';
import { selectConfiguredModelIds } from '@/app/store/training-config';

import type {
  AppModelDefaults,
  ModelPaths,
} from '../training-config-form/use-training-config-form';
import { SectionHeaderExtra } from './section-header-extra';

const ExperimentalBadge = () => (
  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900 dark:text-amber-300">
    Experimental
  </span>
);

type ModelSelectSectionProps = {
  modelId: string;
  selectedProvider: TrainingProvider;
  modelPaths: ModelPaths;
  appModelDefaults: AppModelDefaults;
  onModelChange: (modelId: string) => void;
  onProviderChange: (provider: TrainingProvider) => void;
  onModelPathChange: (component: ModelComponentType, path: string) => void;
  currentModel: ModelDefinition;
  visibleFields: Set<TrainingFieldName>;
  viewMode: ExpertiseTier;
  hiddenChangesCount?: number;
};

const ModelSelectSectionComponent = ({
  modelId,
  selectedProvider,
  modelPaths,
  appModelDefaults,
  onModelChange,
  onProviderChange,
  onModelPathChange,
  currentModel,
  visibleFields,
  viewMode,
  hiddenChangesCount,
}: ModelSelectSectionProps) => {
  useEnsureModelStatuses();
  const dispatch = useAppDispatch();

  const configuredIds = useAppSelector(selectConfiguredModelIds);
  const hasLoadedStatuses = useAppSelector(selectHasLoadedModelStatuses);
  const [showAll, setShowAll] = useState(false);

  // Only offer models that are actually set up (paths saved or downloads
  // installed). Until statuses load, installed-ness is unknown — show
  // everything rather than a briefly empty list.
  const filterActive = hasLoadedStatuses && !showAll;

  const modelGroups = useMemo(() => {
    return getModelsByArchitecture(modelId)
      .map((group) => ({
        groupLabel: group.label,
        items: group.models
          // The current model always stays listed (mirrors the keep-current
          // rule in getSelectableProviders) so a loaded config renders its
          // own selection.
          .filter(
            (m) => !filterActive || configuredIds.has(m.id) || m.id === modelId,
          )
          .map(
            (m) =>
              ({
                value: m.id,
                label: (
                  <div className="flex flex-col">
                    <span className="flex items-center gap-1.5">
                      {m.name}
                      {m.experimental && <ExperimentalBadge />}
                      {hasLoadedStatuses && !configuredIds.has(m.id) && (
                        <span className="ml-auto text-xs text-slate-400">
                          Not set up
                        </span>
                      )}
                    </span>
                  </div>
                ),
              }) satisfies DropdownItem<string>,
          ),
      }))
      .filter((group) => group.items.length > 0);
  }, [filterActive, configuredIds, hasLoadedStatuses, modelId]);

  // The toggle only appears when it would change the list — i.e. something
  // is actually hidden (or currently revealed by it).
  const hasHiddenModels = useMemo(() => {
    if (!hasLoadedStatuses) return false;
    return getModelsByArchitecture(modelId).some((group) =>
      group.models.some((m) => !configuredIds.has(m.id) && m.id !== modelId),
    );
  }, [hasLoadedStatuses, configuredIds, modelId]);

  const currentConfigured =
    !hasLoadedStatuses || configuredIds.has(currentModel.id);

  const handleOpenModelSetup = useCallback(() => {
    dispatch(
      openModelManagerModal({ tab: 'training', modelId: currentModel.id }),
    );
  }, [dispatch, currentModel.id]);

  const handleOpenBackendSettings = useCallback(() => {
    dispatch(openModelManagerModal({ tab: 'settings' }));
  }, [dispatch]);

  // Backends with no install folder saved are dropped from the list — there's
  // nothing to train with. The exceptions are the current pick (a loaded
  // config must render its own selection) and the case where *none* of this
  // model's backends are installed, where an empty menu would help nobody.
  const configuredBackends = useConfiguredBackends();

  const missingProviders = useMemo(
    () => getMissingProviders(currentModel, configuredBackends),
    [currentModel, configuredBackends],
  );
  const noBackendConfigured = hasNoConfiguredProvider(
    currentModel,
    configuredBackends,
  );
  const selectedProviderMissing =
    selectedProvider !== 'mock' && missingProviders.includes(selectedProvider);

  const backendItems = useMemo(
    () =>
      getSelectableProviders(
        currentModel,
        selectedProvider,
        configuredBackends,
      ).map((p): DropdownItem<TrainingProvider> => ({
        value: p,
        label: (
          <span className="flex items-center gap-1.5">
            {TRAINING_PROVIDER_LABELS[p]}
            {missingProviders.includes(p) && (
              <span className="ml-auto text-xs text-slate-400">Not set up</span>
            )}
          </span>
        ),
      })),
    [currentModel, selectedProvider, configuredBackends, missingProviders],
  );

  const backendWarning = useMemo(() => {
    if (noBackendConfigured) {
      const names = missingProviders
        .map((p) => TRAINING_PROVIDER_SHORT_LABELS[p])
        .join(' or ');
      return missingProviders.length === 1
        ? `${names} isn't set up — this model can't train until it is.`
        : `No backend for this model is set up (${names}).`;
    }
    if (selectedProviderMissing) {
      return `${TRAINING_PROVIDER_SHORT_LABELS[selectedProvider]} isn't set up — pick another backend, or set it up.`;
    }
    return null;
  }, [
    noBackendConfigured,
    missingProviders,
    selectedProviderMissing,
    selectedProvider,
  ]);

  const modelDefaults = appModelDefaults[currentModel.id];

  // Component tier logic:
  //   checkpoint → always simple (user commonly changes this)
  //   other required → simple if no app default, intermediate if pre-filled
  //   optional → always intermediate
  const visibleComponents = useMemo(
    () =>
      getModelComponents(currentModel, selectedProvider).filter((c) => {
        // `diffusers` is the whole model for the backends that use it, so it
        // gets the same always-visible treatment as `checkpoint`.
        if (c.type === 'checkpoint' || c.type === 'diffusers') return true;
        if (!c.required) return isTierAtLeast(viewMode, 'advanced');
        const hasAppDefault = !!modelDefaults?.[c.type];
        return isTierAtLeast(viewMode, hasAppDefault ? 'advanced' : 'simple');
      }),
    [currentModel, selectedProvider, viewMode, modelDefaults],
  );

  const handlePathChange = useCallback(
    (component: ModelComponentType) => (path: string) => {
      onModelPathChange(component, path);
    },
    [onModelPathChange],
  );

  const isSimple = viewMode === 'simple' || viewMode === 'intermediate';

  // In Simple view the component files collapse into a compact read-only
  // summary once set — only unset components keep their full input so the
  // user can still supply a required path (e.g. the checkpoint). Editing an
  // already-set path is an Intermediate-and-up affair.
  const [setComponents, unsetComponents] = useMemo(() => {
    const set: typeof visibleComponents = [];
    const unset: typeof visibleComponents = [];
    for (const c of visibleComponents) {
      ((modelPaths[c.type] ?? '').trim() !== '' ? set : unset).push(c);
    }
    return [set, unset];
  }, [visibleComponents, modelPaths]);

  const renderPathField = (component: (typeof visibleComponents)[number]) => (
    <div key={component.type}>
      <FormTitle className="flex items-baseline gap-1.5">
        {component.label}
        {!component.required && (
          <span className="font-normal text-slate-400">(optional)</span>
        )}
      </FormTitle>
      <ModelPathField
        value={modelPaths[component.type] ?? ''}
        onChange={handlePathChange(component.type)}
        browseTitle={component.label}
        downloadId={component.downloadId}
        savedDefaultPath={modelDefaults?.[component.type]}
        setupModelId={currentModel.id}
      />

      {component.hint && (
        <p className="mt-0.5 text-xs text-slate-400">{component.hint}</p>
      )}
    </div>
  );

  return (
    <CollapsibleSection
      title="Model"
      headerExtra={
        <SectionHeaderExtra hiddenChangesCount={hiddenChangesCount} />
      }
    >
      <div className="space-y-3">
        {visibleFields.has('modelId') && (
          <div>
            <div className="flex">
              <div className="w-1/2">
                <FormTitle>Base Model</FormTitle>

                <Dropdown
                  items={modelGroups}
                  selectedValue={modelId}
                  onChange={onModelChange}
                  selectedValueRenderer={() => (
                    <span className="flex items-center gap-1.5 text-sm">
                      {currentModel.name}
                      {currentModel.experimental && <ExperimentalBadge />}
                    </span>
                  )}
                  aria-label="Select base model"
                  footer={
                    hasHiddenModels ? (
                      <div className="flex px-3 py-2">
                        <Checkbox
                          size="sm"
                          isSelected={showAll}
                          onChange={() => setShowAll((v) => !v)}
                          label="Show models that aren't set up"
                          ariaLabel="Show models that aren't set up"
                        />
                      </div>
                    ) : undefined
                  }
                />
                <p className="mt-2 text-sm text-slate-400">
                  {currentModel.description}
                </p>

                {!currentConfigured && (
                  <p className="mt-1 text-sm text-slate-500">
                    Some components aren&apos;t set up.{' '}
                    <button
                      type="button"
                      onClick={handleOpenModelSetup}
                      className="cursor-pointer text-indigo-600 underline hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
                    >
                      Open Model Setup…
                    </button>
                  </p>
                )}

                {currentModel.experimental && (
                  <p className="mt-1 text-sm text-amber-600 dark:text-amber-400">
                    Untested — video models currently train on still images
                    only, and weights must be supplied manually.
                  </p>
                )}

                {currentModel.tips && currentModel.tips.length > 0 && (
                  <ul className="mt-2 ml-4 list-disc space-y-1">
                    {currentModel.tips.map((tip) => (
                      <li key={tip} className="text-xs text-slate-400/80">
                        {tip}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Backend — every provider this model supports that's
                  actually installed (plus the current pick, always). */}
              <div className="w-1/2">
                <FormTitle>Backend</FormTitle>

                <Dropdown
                  items={backendItems}
                  selectedValue={selectedProvider}
                  onChange={onProviderChange}
                  aria-label="Training backend"
                />

                {backendWarning && (
                  <p className="mt-1 text-sm text-amber-600 dark:text-amber-400">
                    {backendWarning}{' '}
                    <button
                      type="button"
                      onClick={handleOpenBackendSettings}
                      className="cursor-pointer underline hover:text-amber-500"
                    >
                      Open Settings…
                    </button>
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Model component paths. Simple view summarises set files and only
            keeps unset ones interactive; Intermediate+ shows every field. */}
        {visibleFields.has('modelPaths') &&
          (isSimple ? (
            <>
              {setComponents.length > 0 && (
                <div className="space-y-1 rounded-md bg-slate-500/5 px-3 py-2">
                  {setComponents.map((component) => {
                    const path = modelPaths[component.type] ?? '';
                    return (
                      <div
                        key={component.type}
                        className="flex items-baseline justify-between gap-3 text-sm"
                      >
                        <span className="shrink-0 text-slate-400">
                          {component.label}
                        </span>
                        <span
                          className="min-w-0 truncate font-medium"
                          title={path}
                        >
                          {path.split(/[\\/]/).pop() || path}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              {unsetComponents.map(renderPathField)}
            </>
          ) : (
            visibleComponents.map(renderPathField)
          ))}
      </div>
    </CollapsibleSection>
  );
};

export const ModelSelectSection = memo(ModelSelectSectionComponent);
