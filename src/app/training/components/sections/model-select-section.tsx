import { memo, useCallback, useMemo } from 'react';

import {
  type ExpertiseTier,
  isTierAtLeast,
} from '@/app/services/training/field-registry';
import {
  getModelsByArchitecture,
  type ModelComponentType,
  type ModelDefinition,
} from '@/app/services/training/models';
import {
  TRAINING_PROVIDER_LABELS,
  type TrainingProvider,
} from '@/app/services/training/types';
import { CollapsibleSection } from '@/app/shared/collapsible-section';
import { Dropdown, type DropdownItem } from '@/app/shared/dropdown';
import { FormTitle } from '@/app/shared/form-title/form-title';

import { ModelPathField } from '../model-path-field/model-path-field';
import { useEnsureModelStatuses } from '../model-path-field/use-ensure-model-statuses';
import type {
  AppModelDefaults,
  FormState,
  ModelPaths,
} from '../training-config-form/use-training-config-form';

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
  visibleFields: Set<string>;
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

  const modelGroups = useMemo(() => {
    return getModelsByArchitecture().map((group) => ({
      groupLabel: group.label,
      items: group.models.map(
        (m) =>
          ({
            value: m.id,
            label: (
              <div className="flex flex-col">
                <span className="flex items-center gap-1.5">
                  {m.name}
                  {m.experimental && <ExperimentalBadge />}
                </span>
              </div>
            ),
          }) satisfies DropdownItem<string>,
      ),
    }));
  }, []);

  const modelDefaults = appModelDefaults[currentModel.id];

  // Component tier logic:
  //   checkpoint → always simple (user commonly changes this)
  //   other required → simple if no app default, intermediate if pre-filled
  //   optional → always intermediate
  const visibleComponents = useMemo(
    () =>
      currentModel.components.filter((c) => {
        if (c.type === 'checkpoint') return true;
        if (!c.required) return isTierAtLeast(viewMode, 'intermediate');
        const hasAppDefault = !!modelDefaults?.[c.type];
        return isTierAtLeast(
          viewMode,
          hasAppDefault ? 'intermediate' : 'simple',
        );
      }),
    [currentModel.components, viewMode, modelDefaults],
  );

  const handlePathChange = useCallback(
    (component: ModelComponentType) => (path: string) => {
      onModelPathChange(component, path);
    },
    [onModelPathChange],
  );

  const isSimple = viewMode === 'simple';

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
        resetTo={modelDefaults?.[component.type]}
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
        hiddenChangesCount ? (
          <span className="text-xs text-amber-500/70">
            {hiddenChangesCount} hidden{' '}
            {hiddenChangesCount === 1 ? 'setting' : 'settings'} customised
          </span>
        ) : undefined
      }
    >
      <div className="space-y-3">
        {visibleFields.has('modelId' satisfies keyof FormState) && (
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
                />
                <p className="mt-2 text-sm text-slate-400">
                  {currentModel.description}
                </p>

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

              {/* Backend — lists every provider this model supports */}
              <div className="w-1/2">
                <FormTitle>Backend</FormTitle>

                <Dropdown
                  items={currentModel.providers.map(
                    (p): DropdownItem<TrainingProvider> => ({
                      value: p,
                      label: TRAINING_PROVIDER_LABELS[p],
                    }),
                  )}
                  selectedValue={selectedProvider}
                  onChange={onProviderChange}
                  aria-label="Training backend"
                />
              </div>
            </div>
          </div>
        )}

        {/* Model component paths. Simple view summarises set files and only
            keeps unset ones interactive; Intermediate+ shows every field. */}
        {visibleFields.has('modelPaths' satisfies keyof FormState) &&
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
