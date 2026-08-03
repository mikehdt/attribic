'use client';

import { getAllModelComponents } from '@/app/services/training/models';
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
export function TrainingTab() {
  const { groups, selectedModel, selectModel, draft, setPath, readiness, statuses } =
    useTrainingTab();
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
            <p className="mt-1 text-sm text-slate-400">
              Point each component at your own weights, or download them here.
              Paths save automatically and pre-fill the training form.
            </p>
          </div>

          {/* Every backend's components, since defaults are set before a
              backend is chosen. Backend-specific ones are tagged in-row. */}
          {getAllModelComponents(selectedModel).map((component) => (
            <ModelComponentRow
              key={component.type}
              model={selectedModel}
              component={component}
              value={draft[selectedModel.id]?.[component.type] ?? ''}
              onChange={(path) =>
                setPath(selectedModel.id, component.type, path)
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
