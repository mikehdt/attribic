'use client';

import { BookmarkIcon } from 'lucide-react';

import { Button } from '@/app/shared/button';
import { Checkbox } from '@/app/shared/checkbox';
import { Modal } from '@/app/shared/modal';
import { MultiTagInput } from '@/app/shared/multi-tag-input';
import { RadioGroup } from '@/app/shared/radio-group';
import { ScopingCheckboxes } from '@/app/shared/scoping-checkboxes';
import { TagStatusLegend } from '@/app/shared/tag-status-legend';

import { useAddTagsModal } from './use-add-tags-modal';

type AddTagsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onAddTag: (
    tag: string,
    addToStart?: boolean,
    onlySelectedAssets?: boolean,
    onlyFilteredAssets?: boolean,
  ) => void;
  onAddMultipleTags?: (
    tags: string[],
    addToStart?: boolean,
    onlySelectedAssets?: boolean,
    onlyFilteredAssets?: boolean,
  ) => void;
  onClearSelection?: () => void;
};

export const AddTagsModal = ({
  isOpen,
  onClose,
  onAddTag,
  onAddMultipleTags,
  onClearSelection,
}: AddTagsModalProps) => {
  const {
    tags,
    setTags,
    keepSelection,
    setKeepSelection,
    addToStart,
    setAddToStart,
    hasActiveFilters,
    assetsWithActiveFiltersCount,
    selectedAssetsCount,
    hasSelectedAssets,
    applyToSelectedAssets,
    setApplyToSelectedAssets,
    applyToAssetsWithActiveFilters,
    setApplyToAssetsWithActiveFilters,
    memoizedTagsStatus,
    hasInvalidConstraints,
    hasNoAffectedAssets,
    isFormInvalid,
    handleSubmit,
    handleDuplicateCheck,
    getSummaryMessage,
  } = useAddTagsModal({
    isOpen,
    onClose,
    onAddTag,
    onAddMultipleTags,
    onClearSelection,
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="max-w-lg min-w-[24rem]"
      labelledById="add-tags-modal-title"
    >
      <div className="flex flex-col gap-4">
        {/* Title */}
        <h2
          id="add-tags-modal-title"
          className="w-full text-2xl font-semibold text-slate-700 dark:text-slate-200"
        >
          Add Tags
        </h2>

        {/* Scoping checkboxes - at top so user sees scope first */}
        <ScopingCheckboxes
          hasActiveFilters={hasActiveFilters}
          filteredCount={assetsWithActiveFiltersCount}
          scopeToFiltered={applyToAssetsWithActiveFilters}
          onScopeToFilteredChange={setApplyToAssetsWithActiveFilters}
          hasSelectedAssets={hasSelectedAssets}
          selectedCount={selectedAssetsCount}
          scopeToSelected={applyToSelectedAssets}
          onScopeToSelectedChange={setApplyToSelectedAssets}
          requireBothConstraints
          requireAtLeastOne
          showBorder
        />

        {/* Summary of how many assets will be affected */}
        {!hasInvalidConstraints &&
          (hasNoAffectedAssets ? (
            <p className="text-sm text-rose-600">
              No assets match the current selection and filter combination.
            </p>
          ) : (
            <p className="text-sm text-slate-500">{getSummaryMessage()}</p>
          ))}

        {/* Tag input form */}
        <form onSubmit={handleSubmit} className="flex flex-wrap gap-4">
          <MultiTagInput
            tags={tags}
            onTagsChange={setTags}
            duplicateCheck={handleDuplicateCheck}
            tagStatus={memoizedTagsStatus}
            autoFocus
            className="w-full"
          />

          {tags.length === 0 ? (
            <p className="text-sm text-slate-500">
              Tags to add to selected assets. Press Enter, Tab, or use commas to
              add new tags.
            </p>
          ) : memoizedTagsStatus.some(
              (t) => t.status === 'some' || t.status === 'all',
            ) ? (
            <TagStatusLegend
              all={{
                show: memoizedTagsStatus.some((t) => t.status === 'all'),
                message:
                  'Red tags exist on all selected assets and will be disregarded.',
              }}
              some={{
                show: memoizedTagsStatus.some((t) => t.status === 'some'),
                message:
                  'Yellow tags exist on some assets and will only be added to assets without them.',
              }}
            />
          ) : (
            <p className="text-sm text-slate-500">
              Tags will be added to all selected assets that don&apos;t already
              have them.
            </p>
          )}

          {/* Tag position */}
          <div className="w-full border-t border-t-slate-300 pt-4 dark:border-t-slate-600">
            <RadioGroup
              name="tagPosition"
              options={[
                { value: 'prepend', label: 'Prepend to start' },
                { value: 'append', label: 'Append to end' },
              ]}
              value={addToStart ? 'prepend' : 'append'}
              onChange={(mode) => setAddToStart(mode === 'prepend')}
            />
          </div>

          {/* Keep selection checkbox */}
          <div className="flex w-full items-center">
            <Checkbox
              isSelected={keepSelection}
              onChange={() => setKeepSelection((v) => !v)}
              label="Keep asset selection after adding new tags"
              ariaLabel="Keep asset selection after adding new tags"
            />
          </div>

          {/* Action buttons */}
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
              disabled={isFormInvalid}
              neutralDisabled
              color="amber"
              size="md"
              width="lg"
            >
              <BookmarkIcon />
              Add New Tags
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
};
