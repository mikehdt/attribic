'use client';

import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { type ReactNode,useState } from 'react';

import {
  type BackendComponentGroup,
  getComponentsByBackend,
} from '@/app/services/training/models';
import { useAppSelector } from '@/app/store/hooks';
import { selectIsScanningModels } from '@/app/store/model-manager';

import { ModelComponentRow } from './model-component-row';
import { ModelList } from './model-list';
import { useTrainingTab } from './use-training-tab';

/**
 * Per-model training setup: pick a model on the left, and the right pane
 * shows everything that model needs — one row per component, combining the
 * default path with the managed download for it (where one exists).
 */
export function TrainingTab({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}) {
  const {
    groups,
    configuredBackends,
    selectedModel,
    selectModel,
    draft,
    setPath,
    readiness,
    statuses,
  } = useTrainingTab();
  const isScanning = useAppSelector(selectIsScanningModels);

  if (isScanning && Object.keys(statuses).length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-slate-400">
        Checking model status...
      </div>
    );
  }

  return (
    <div className="flex h-[60vh] gap-4 px-1">
      <ModelList
        groups={groups}
        selectedId={selectedModel?.id}
        onSelect={selectModel}
        readiness={readiness}
      />

      {selectedModel && (
        <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
          <div className="mb-1">
            <h3 className="font-medium text-slate-800 dark:text-slate-200">
              {selectedModel.name}
            </h3>
            <p className="mt-0.5 text-sm text-slate-500">
              {selectedModel.description}
            </p>
          </div>

          {/* Every backend's components, since defaults are set before a
              backend is chosen. Grouped under the backend(s) that load them,
              collapsed when that backend has no location saved yet. */}
          {getComponentsByBackend(selectedModel).map((group) => (
            <ComponentGroup
              key={`${selectedModel.id}:${group.label}`}
              group={group}
              configured={group.providers.some(
                (provider) => configuredBackends[provider],
              )}
              onOpenSettings={onOpenSettings}
            >
              {group.components.map((component) => (
                <ModelComponentRow
                  key={component.type}
                  component={component}
                  value={draft[selectedModel.id]?.[component.type] ?? ''}
                  onChange={(path) =>
                    setPath(selectedModel.id, component.type, path)
                  }
                />
              ))}
            </ComponentGroup>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One backend's slice of the selected model's files. Unconfigured backends
 * collapse to a note pointing at Settings, but stay expandable — defaults
 * can be filled in before the backend itself is set up.
 */
function ComponentGroup({
  group,
  configured,
  onOpenSettings,
  children,
}: {
  group: BackendComponentGroup;
  configured: boolean;
  onOpenSettings: () => void;
  children: ReactNode;
}) {
  const [expandedUnset, setExpandedUnset] = useState(false);
  const isExpanded = configured || expandedUnset;

  return (
    <section>
      <h4 className="mb-2 flex items-center justify-between gap-2 border-b border-slate-200 pb-1 text-xs font-medium tracking-wide text-slate-400 uppercase dark:border-slate-700">
        <span>{group.label}</span>
        {!configured && (
          <button
            type="button"
            onClick={() => setExpandedUnset((prev) => !prev)}
            aria-expanded={isExpanded}
            title={isExpanded ? 'Collapse' : 'Show files'}
            className="rounded-sm p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700/50 dark:hover:text-slate-300"
          >
            {isExpanded ? (
              <ChevronDownIcon className="h-3.5 w-3.5" />
            ) : (
              <ChevronRightIcon className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </h4>

      {!configured && (
        <p className="mb-2 text-sm text-slate-400 dark:text-slate-500">
          Backend not set up —{' '}
          <button
            type="button"
            onClick={onOpenSettings}
            className="text-sky-600 hover:underline dark:text-sky-400"
          >
            add its folder in Settings
          </button>{' '}
          to train with these files.
        </p>
      )}

      {isExpanded && <div className="flex flex-col gap-2">{children}</div>}
    </section>
  );
}
