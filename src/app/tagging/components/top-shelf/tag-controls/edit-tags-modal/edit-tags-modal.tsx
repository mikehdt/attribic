'use client';

import { BookmarkIcon } from 'lucide-react';

import { Button } from '@/app/shared/button';
import { Modal } from '@/app/shared/modal';
import { ScopingCheckboxes } from '@/app/shared/scoping-checkboxes';
import { TagStatusLegend } from '@/app/shared/tag-status-legend';

import { useEditTagsModal } from './use-edit-tags-modal';

interface EditTagsModalProps {
  isOpen: boolean;
  onClose: () => void;
  filterTags: string[];
}

export const EditTagsModal = ({
  isOpen,
  onClose,
  filterTags,
}: EditTagsModalProps) => {
  const {
    isFilteredScopeMeaningful,
    filteredAssets,
    selectedAssetsCount,
    hasSelectedAssets,
    onlyFilteredAssets,
    setOnlyFilteredAssets,
    onlySelectedAssets,
    setOnlySelectedAssets,
    editedTags,
    scopedFilterTags,
    memoizedTagsStatus,
    tagStatuses,
    hasModifiedTags,
    hasNoAffectedAssets,
    hasStatusSome,
    hasStatusAll,
    hasStatusFormDuplicate,
    handleTagChange,
    handleSubmit,
    getSummaryMessage,
  } = useEditTagsModal(isOpen, onClose, filterTags);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="max-w-lg min-w-[24rem]"
      labelledById="edit-tags-modal-title"
    >
      <div className="flex flex-col gap-4">
        {/* Title */}
        <h2
          id="edit-tags-modal-title"
          className="w-full text-2xl font-semibold text-slate-700 dark:text-slate-200"
        >
          Edit Tags
        </h2>

        {/* Scoping checkboxes - at top so tag list can react to scope changes */}
        <ScopingCheckboxes
          hasActiveFilters={isFilteredScopeMeaningful}
          filteredCount={filteredAssets.length}
          scopeToFiltered={onlyFilteredAssets}
          onScopeToFilteredChange={setOnlyFilteredAssets}
          hasSelectedAssets={hasSelectedAssets}
          selectedCount={selectedAssetsCount}
          scopeToSelected={onlySelectedAssets}
          onScopeToSelectedChange={setOnlySelectedAssets}
          showBorder
        />

        {/* Summary message */}
        {hasNoAffectedAssets ? (
          <p className="text-xs text-rose-600">
            No assets match the current selection and filter combination.
          </p>
        ) : (
          <p className="text-xs text-slate-500">{getSummaryMessage()}</p>
        )}

        {/* Selected tags count - now shows scoped count */}
        <p className="text-sm text-slate-500">
          {scopedFilterTags.length === 0 ? (
            'No selected tags exist on assets in the current scope.'
          ) : (
            <>
              Editing{' '}
              <span className="font-medium">{scopedFilterTags.length}</span>{' '}
              {scopedFilterTags.length === 1 ? 'tag' : 'tags'}
              {scopedFilterTags.length < filterTags.length && (
                <span className="text-slate-400">
                  {' '}
                  (of {filterTags.length} selected)
                </span>
              )}
              .
            </>
          )}
        </p>

        {/* Tag editing form */}
        <form onSubmit={handleSubmit} className="flex flex-wrap gap-4">
          <div className="flex w-full flex-wrap gap-3">
            {tagStatuses.map(({ tag, status }, index) => {
              // Define style variants based on status
              const inputStyles = {
                none: 'border-slate-300 inset-shadow-slate-300/0 focus:inset-shadow-slate-300 dark:border-slate-500 dark:focus:inset-shadow-slate-600',
                some: 'border-amber-300 bg-amber-50 text-amber-800 inset-shadow-amber-300/0 focus:inset-shadow-amber-300 focus:ring-amber-400 focus:border-amber-600 dark:border-amber-500 dark:focus:inset-shadow-amber-600',
                all: 'border-rose-300 bg-rose-50 text-rose-800 inset-shadow-rose-300/0 focus:inset-shadow-rose-300 focus:ring-rose-400 focus:border-rose-600 dark:border-rose-500 dark:focus:inset-shadow-rose-600',
                duplicate:
                  'border-purple-300 bg-purple-50 text-purple-800 inset-shadow-purple-300/0 focus:inset-shadow-purple-300 focus:ring-purple-400 focus:border-purple-600 dark:border-purple-500 dark:focus:inset-shadow-purple-600',
              };

              // Get duplicate info for tooltips
              const info = memoizedTagsStatus[tag] || {
                isDuplicate: false,
                duplicateCount: 0,
                totalSelected: 0,
                isAllDuplicates: false,
              };

              // Generate appropriate tooltip text
              let tooltipText = '';
              if (status === 'some') {
                if (info.wouldCreateDuplicates) {
                  tooltipText = `Would create duplicates in ${info.assetsWithBothTags} of ${info.assetsWithOriginalTag} assets with this tag`;
                } else {
                  tooltipText = `Tag exists in ${info.duplicateCount} of ${info.totalSelected} selected assets`;
                }
              } else if (status === 'all') {
                if (info.wouldCreateDuplicates) {
                  tooltipText = `Would create duplicates in ALL ${info.assetsWithOriginalTag} assets with this tag`;
                } else {
                  tooltipText = `Tag already exists in all ${info.totalSelected} selected assets`;
                }
              } else if (status === 'duplicate') {
                tooltipText =
                  'Multiple tags are being renamed to the same value - duplicates within assets will be cleaned up automatically';
              }

              return (
                <div
                  key={`${tag}-${index}`}
                  className="flex w-full items-center"
                >
                  {/* Original tag */}
                  <div className="relative w-1/2 truncate pr-10 font-medium text-slate-500 dark:text-slate-400">
                    {tag}
                    <div className="absolute top-0 right-0 w-10 text-center text-slate-700 dark:text-slate-500">
                      -&gt;
                    </div>
                  </div>

                  {/* Edit field */}
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={editedTags[tag] || ''}
                      onChange={(e) => handleTagChange(tag, e.target.value)}
                      className={`w-full rounded-full border px-4 py-1 inset-shadow-sm focus:outline ${inputStyles[status] || inputStyles.none}`}
                      placeholder="New tag name"
                      title={tooltipText}
                      aria-label={`Rename tag ${tag}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-4 text-xs text-slate-500">
            <p className="w-full">
              Editing a tag will update it across all assets where it appears.
              Multiple tags can be renamed to the same value. Duplicate tags
              within assets will be automatically cleaned up.
            </p>

            <TagStatusLegend
              all={{
                show: hasStatusAll,
                message:
                  'Red highlights indicate the tag would create duplicates in all assets that have this tag.',
              }}
              some={{
                show: hasStatusSome,
                message:
                  'Yellow highlights indicate the tag exists in some assets or would create duplicates in some (but not all) assets.',
              }}
              duplicate={{
                show: hasStatusFormDuplicate,
                message:
                  'Purple highlights indicate multiple tags are being renamed to the same value.',
              }}
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
              disabled={
                !hasModifiedTags ||
                hasNoAffectedAssets ||
                scopedFilterTags.length === 0
              }
              neutralDisabled
              color="indigo"
              size="md"
              width="lg"
            >
              <BookmarkIcon />
              Save Changes
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
};
