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
                <span>{m.name}</span>
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
                <FormTitle>
                  Base Model
                </FormTitle>

                <Dropdown
                  items={modelGroups}
                  selectedValue={modelId}
                  onChange={onModelChange}
                  selectedValueRenderer={() => (
                    <span className="text-sm">{currentModel.name}</span>
                  )}
                  aria-label="Select base model"
                />
                <p className="mt-2 text-xs text-slate-400">
                  {currentModel.description}
                </p>

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
                <FormTitle>
                  Backend
                </FormTitle>

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

        {/* Model component paths */}
        {visibleFields.has('modelPaths' satisfies keyof FormState) &&
          visibleComponents.map((component) => (
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
                <p className="mt-0.5 text-xs text-slate-400">
                  {component.hint}
                </p>
              )}
            </div>
          ))}
      </div>
    </CollapsibleSection>
  );
};

export const ModelSelectSection = memo(ModelSelectSectionComponent);
