'use client';

import { ReplaceIcon } from 'lucide-react';

import { Button } from '@/app/shared/button';
import { Checkbox } from '@/app/shared/checkbox';
import { Modal } from '@/app/shared/modal';
import { ScopingCheckboxes } from '@/app/shared/scoping-checkboxes';
import { SegmentedControl } from '@/app/shared/segmented-control/segmented-control';
import { highlightRanges } from '@/app/shared/text-highlight';

import {
  type SearchReplaceTarget,
  useSearchReplaceModal,
} from './use-search-replace-modal';

interface SearchReplaceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const MATCH_HIGHLIGHT_CLASS =
  'rounded-sm bg-amber-200/80 px-0.5 text-amber-950 dark:bg-amber-500/40 dark:text-amber-100';

const INPUT_CLASS =
  'w-full rounded-full border border-slate-300 px-4 py-1 inset-shadow-sm inset-shadow-slate-300/0 focus:inset-shadow-slate-300 focus:outline dark:border-slate-500 dark:focus:inset-shadow-slate-600';

const TARGET_OPTIONS: { value: SearchReplaceTarget; label: string }[] = [
  { value: 'tags', label: 'Tags' },
  { value: 'captions', label: 'Captions' },
];

export const SearchReplaceModal = ({
  isOpen,
  onClose,
}: SearchReplaceModalProps) => {
  const {
    pattern,
    setPattern,
    replacement,
    setReplacement,
    useRegex,
    setUseRegex,
    matchCase,
    setMatchCase,
    target,
    setTarget,
    showTargetChooser,
    hasActiveFilters,
    filteredCount,
    hasSelectedAssets,
    selectedAssetsCount,
    onlyFilteredAssets,
    setOnlyFilteredAssets,
    onlySelectedAssets,
    setOnlySelectedAssets,
    scopedAssetCount,
    tagPreview,
    captionPreview,
    captionPreviewLimit,
    affectedAssetCount,
    patternError,
    replacementHasComma,
    canApply,
    handleSubmit,
    getSummaryMessage,
  } = useSearchReplaceModal(isOpen, onClose);

  const hasPattern = pattern.trim() !== '';
  const showNoMatches =
    hasPattern && !patternError && !replacementHasComma && !canApply;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="max-w-lg min-w-[24rem]"
      labelledById="search-replace-modal-title"
    >
      <div className="flex flex-col gap-4">
        <h2
          id="search-replace-modal-title"
          className="w-full text-2xl font-semibold text-slate-700 dark:text-slate-200"
        >
          Search &amp; Replace
        </h2>

        {showTargetChooser && (
          <SegmentedControl
            options={TARGET_OPTIONS}
            value={target}
            onChange={setTarget}
            size="sm"
          />
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="text"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            className={INPUT_CLASS}
            placeholder="Search"
            aria-label="Search pattern"
          />

          <input
            type="text"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            className={INPUT_CLASS}
            placeholder="Replace with (empty to remove)"
            aria-label="Replacement text"
          />

          <div className="flex gap-6">
            <Checkbox
              isSelected={matchCase}
              onChange={() => setMatchCase(!matchCase)}
              label="Match case"
              ariaLabel="Match case"
            />
            <Checkbox
              isSelected={useRegex}
              onChange={() => setUseRegex(!useRegex)}
              label="Regular expression"
              ariaLabel="Use regular expression"
            />
          </div>

          {patternError && (
            <p className="text-sm text-rose-600">{patternError}</p>
          )}

          {replacementHasComma && (
            <p className="text-sm text-rose-600">
              The replacement can&apos;t contain commas when targeting tags —
              tags are comma-separated. Switch the target to captions or remove
              the comma.
            </p>
          )}

          <ScopingCheckboxes
            hasActiveFilters={hasActiveFilters}
            filteredCount={filteredCount}
            scopeToFiltered={onlyFilteredAssets}
            onScopeToFilteredChange={setOnlyFilteredAssets}
            hasSelectedAssets={hasSelectedAssets}
            selectedCount={selectedAssetsCount}
            scopeToSelected={onlySelectedAssets}
            onScopeToSelectedChange={setOnlySelectedAssets}
            showBorder
          />

          {scopedAssetCount === 0 ? (
            <p className="text-sm text-rose-600">
              No assets match the current selection and filter combination.
            </p>
          ) : (
            <p className="text-sm text-slate-500">{getSummaryMessage()}</p>
          )}

          {/* Preview */}
          {canApply && target === 'tags' && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-slate-500">
                <span className="font-medium">{tagPreview.rows.length}</span>{' '}
                {tagPreview.rows.length === 1 ? 'tag' : 'tags'} will change
                across <span className="font-medium">{affectedAssetCount}</span>{' '}
                {affectedAssetCount === 1 ? 'asset' : 'assets'}.
              </p>

              <div className="flex max-h-64 flex-col gap-1 overflow-y-auto text-sm">
                {tagPreview.rows.map((row) => (
                  <div
                    key={row.oldTagName}
                    className="flex w-full items-baseline"
                  >
                    <div className="relative w-1/2 truncate pr-10 text-slate-600 dark:text-slate-300">
                      {highlightRanges(
                        row.oldTagName,
                        row.ranges,
                        MATCH_HIGHLIGHT_CLASS,
                      )}
                      <div className="absolute top-0 right-0 w-10 text-center text-slate-400 dark:text-slate-500">
                        -&gt;
                      </div>
                    </div>
                    {row.operation === 'DELETE' ? (
                      <span className="font-medium text-rose-600">removed</span>
                    ) : (
                      <span className="truncate font-medium text-slate-700 dark:text-slate-200">
                        {row.newTagName}
                      </span>
                    )}
                    <span className="ml-auto pl-2 text-slate-400">
                      {row.assetCount}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {canApply && target === 'captions' && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-slate-500">
                Captions on{' '}
                <span className="font-medium">{affectedAssetCount}</span>{' '}
                {affectedAssetCount === 1 ? 'asset' : 'assets'} will change.
              </p>

              <div className="flex max-h-64 flex-col gap-2 overflow-y-auto text-sm">
                {captionPreview.rows.map((row) => (
                  <div key={row.fileId} className="w-full">
                    <p className="truncate font-medium text-slate-500 dark:text-slate-400">
                      {row.fileId}
                    </p>
                    <p className="line-clamp-2 text-slate-600 dark:text-slate-300">
                      {highlightRanges(
                        row.caption,
                        row.ranges,
                        MATCH_HIGHLIGHT_CLASS,
                      )}
                    </p>
                  </div>
                ))}
                {affectedAssetCount > captionPreviewLimit && (
                  <p className="text-slate-400">
                    …and {affectedAssetCount - captionPreviewLimit} more{' '}
                    {affectedAssetCount - captionPreviewLimit === 1
                      ? 'asset'
                      : 'assets'}
                    .
                  </p>
                )}
              </div>
            </div>
          )}

          {tagPreview.invalid.length > 0 && (
            <p className="text-sm text-amber-600 dark:text-amber-500">
              {tagPreview.invalid.length}{' '}
              {tagPreview.invalid.length === 1
                ? 'tag was skipped because its result'
                : 'tags were skipped because their results'}{' '}
              would be invalid (
              {[
                ...new Set(
                  tagPreview.invalid.map((i) =>
                    i.reason === 'comma'
                      ? 'contains a comma'
                      : 'matches the hybrid caption delimiter',
                  ),
                ),
              ].join('; ')}
              ).
            </p>
          )}

          {showNoMatches && scopedAssetCount > 0 && (
            <p className="text-sm text-slate-500">
              No {target === 'tags' ? 'tags' : 'captions'} in scope match this
              pattern.
            </p>
          )}

          <p className="text-sm text-slate-500 dark:text-slate-400">
            Changes are staged as unsaved edits — use Save All to write them to
            disk, or reset to discard them.
          </p>

          <div className="flex w-full justify-end gap-2 pt-2">
            <Button
              type="button"
              onClick={onClose}
              color="slate"
              size="md"
              width="lg"
            >
              Cancel
            </Button>

            <Button
              type="submit"
              disabled={!canApply}
              neutralDisabled
              color="sky"
              size="md"
              width="lg"
            >
              <ReplaceIcon />
              Replace
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
};
