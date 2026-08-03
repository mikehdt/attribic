'use client';

import type { ModelReadiness } from '@/app/services/training/model-configured';
import type { getModelsByArchitecture } from '@/app/services/training/models';

type ModelListProps = {
  groups: ReturnType<typeof getModelsByArchitecture>;
  selectedId?: string;
  onSelect: (modelId: string) => void;
  readiness: Record<string, ModelReadiness>;
};

/** Left column of the training setup tab: models grouped by architecture. */
export function ModelList({
  groups,
  selectedId,
  onSelect,
  readiness,
}: ModelListProps) {
  return (
    <nav
      aria-label="Training models"
      className="flex w-56 shrink-0 flex-col gap-3 overflow-y-auto pr-1"
    >
      {groups.map((group) => (
        <div key={group.architecture}>
          <h3 className="mb-1 px-2 text-xs font-medium tracking-wide text-slate-400 uppercase">
            {group.label}
          </h3>
          <div className="flex flex-col gap-0.5">
            {group.models.map((model) => {
              const isSelected = model.id === selectedId;
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => onSelect(model.id)}
                  aria-current={isSelected ? 'true' : undefined}
                  className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                    isSelected
                      ? 'bg-indigo-100 text-indigo-900 dark:bg-indigo-900/50 dark:text-indigo-100'
                      : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700/50'
                  }`}
                >
                  <span className="min-w-0 truncate">{model.name}</span>
                  <ReadinessChip readiness={readiness[model.id]} />
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

/**
 * At-a-glance setup state: Ready (all required components resolve for some
 * backend), a progress count when partly set up, or a hollow dot when
 * nothing is configured yet.
 */
function ReadinessChip({ readiness }: { readiness?: ModelReadiness }) {
  if (!readiness) return null;

  if (readiness.configured) {
    return (
      <span className="shrink-0 rounded-full bg-teal-100 px-1.5 py-0.5 text-xs text-teal-700 dark:bg-teal-900 dark:text-teal-300">
        Ready
      </span>
    );
  }

  if (readiness.resolved > 0) {
    return (
      <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 tabular-nums dark:bg-amber-900 dark:text-amber-300">
        {readiness.resolved}/{readiness.requiredTotal}
      </span>
    );
  }

  return (
    <span
      className="mr-1 h-2 w-2 shrink-0 rounded-full border border-slate-300 dark:border-slate-600"
      title="Not set up"
    />
  );
}
