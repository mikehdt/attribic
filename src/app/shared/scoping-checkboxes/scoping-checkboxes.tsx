'use client';

import { Checkbox } from '../checkbox';

type ScopingCheckboxesProps = {
  // Filtered assets scoping
  hasActiveFilters: boolean;
  filteredCount: number;
  scopeToFiltered: boolean;
  onScopeToFilteredChange: (value: boolean) => void;

  // Selected assets scoping
  hasSelectedAssets: boolean;
  selectedCount: number;
  scopeToSelected: boolean;
  onScopeToSelectedChange: (value: boolean) => void;

  /**
   * When true, at least one available constraint must be ticked — including
   * when only one exists, so unticking the sole scope reads as "nothing
   * chosen" rather than silently falling back to everything it matches.
   */
  requireAtLeastOne?: boolean;

  /**
   * When true, shows a border-top separator above the first checkbox.
   */
  showBorder?: boolean;
};

/**
 * Reusable scoping checkboxes for constraining operations to filtered/selected
 * assets. Each checkbox appears whenever its constraint exists, so a scope is
 * never applied without a box on screen the user can untick.
 */
export const ScopingCheckboxes = ({
  hasActiveFilters,
  filteredCount,
  scopeToFiltered,
  onScopeToFilteredChange,
  hasSelectedAssets,
  selectedCount,
  scopeToSelected,
  onScopeToSelectedChange,
  requireAtLeastOne = false,
  showBorder = false,
}: ScopingCheckboxesProps) => {
  if (!hasSelectedAssets && !hasActiveFilters) {
    return null;
  }

  // Check if validation error should show. A constraint only counts as chosen
  // when it both exists and is ticked, so the message covers the one-checkbox
  // case as well as the two-checkbox one.
  const hasInvalidConstraints =
    requireAtLeastOne &&
    !(hasSelectedAssets && scopeToSelected) &&
    !(hasActiveFilters && scopeToFiltered);

  const borderClasses = showBorder
    ? 'w-full border-t border-t-slate-300 pt-4 dark:border-t-slate-600'
    : '';

  // Apply the border to the first visible checkbox
  const filteredIsFirst = hasActiveFilters;

  return (
    <>
      {hasActiveFilters && (
        <div
          className={`flex w-full items-center ${filteredIsFirst ? borderClasses : ''}`}
        >
          <Checkbox
            isSelected={scopeToFiltered}
            onChange={() => onScopeToFilteredChange(!scopeToFiltered)}
            label={`Scope to filtered assets (${filteredCount} ${filteredCount === 1 ? 'asset' : 'assets'})`}
            ariaLabel="Scope to filtered assets"
          />
        </div>
      )}

      {hasSelectedAssets && (
        <div
          className={`flex items-center ${!filteredIsFirst ? borderClasses : ''}`}
        >
          <Checkbox
            isSelected={scopeToSelected}
            onChange={() => onScopeToSelectedChange(!scopeToSelected)}
            label={`Scope to selected assets (${selectedCount} ${selectedCount === 1 ? 'asset' : 'assets'})`}
            ariaLabel="Scope to selected assets"
          />
        </div>
      )}

      {hasInvalidConstraints && (
        <p className="w-full text-sm text-red-600">
          Select at least one option above to proceed.
        </p>
      )}
    </>
  );
};
