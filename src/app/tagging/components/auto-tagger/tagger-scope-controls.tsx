import { Checkbox } from '@/app/shared/checkbox';
import { FormTitle } from '@/app/shared/form-title/form-title';

import type { TaggerScope } from './use-tagger-scope';

/**
 * The scope checkboxes shared by both settings panels. Unscoped, a batch runs
 * across every asset in the project; each checkbox narrows it. Hidden entirely
 * when there's nothing to narrow by — no filters active and nothing selected —
 * since "all assets" is then the only possible scope.
 */
export function TaggerScopeControls({ scope }: { scope: TaggerScope }) {
  const {
    hasActiveFilters,
    filteredCount,
    hasSelectedAssets,
    selectedAssetsCount,
    onlyFilteredAssets,
    setOnlyFilteredAssets,
    onlySelectedAssets,
    setOnlySelectedAssets,
  } = scope;

  if (!hasActiveFilters && !hasSelectedAssets) return null;

  return (
    <div className="flex flex-col gap-2">
      <FormTitle as="span" size="sm">
        Scope
      </FormTitle>
      <div className="flex flex-wrap gap-4">
        {hasActiveFilters && (
          <Checkbox
            isSelected={onlyFilteredAssets}
            onChange={() => setOnlyFilteredAssets(!onlyFilteredAssets)}
            label={`Only filtered assets (${filteredCount})`}
          />
        )}
        {hasSelectedAssets && (
          <Checkbox
            isSelected={onlySelectedAssets}
            onChange={() => setOnlySelectedAssets(!onlySelectedAssets)}
            label={`Only selected assets (${selectedAssetsCount})`}
          />
        )}
      </div>
    </div>
  );
}
