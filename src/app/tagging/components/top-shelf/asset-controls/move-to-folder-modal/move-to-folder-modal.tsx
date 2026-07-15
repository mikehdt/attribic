'use client';

import {
  FolderInputIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  HomeIcon,
} from 'lucide-react';

import { Button } from '@/app/shared/button';
import { Checkbox } from '@/app/shared/checkbox';
import { Modal } from '@/app/shared/modal';
import { ProgressBar } from '@/app/shared/progress-bar/progress-bar';
import { ScopingCheckboxes } from '@/app/shared/scoping-checkboxes';

import { useMoveToFolderModal } from './use-move-to-folder-modal';

type MoveToFolderModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export const MoveToFolderModal = ({
  isOpen,
  onClose,
}: MoveToFolderModalProps) => {
  const {
    hasActiveFilters,
    assetsWithActiveFiltersCount,
    selectedAssetsCount,
    hasSelectedAssets,
    applyToSelectedAssets,
    setApplyToSelectedAssets,
    applyToAssetsWithActiveFilters,
    setApplyToAssetsWithActiveFilters,
    hasInvalidConstraints,

    selectedDestination,
    setSelectedDestination,
    folderOptions,
    isNewFolderMode,
    newRepeatCount,
    setNewRepeatCount,
    newLabel,
    setNewLabel,
    newFolderName,
    newFolderAlreadyExists,
    isNewLabelValid,
    isNewRepeatCountValid,

    keepSelection,
    setKeepSelection,

    isMoving,
    collisionError,
    moveErrors,

    isFormValid,
    handleSubmit,
    getSummaryMessage,

    DESTINATION_ROOT,
    DESTINATION_NEW,
  } = useMoveToFolderModal({ isOpen, onClose });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="max-w-md min-w-[24rem]"
      preventClose={isMoving}
      labelledById="move-to-folder-modal-title"
    >
      <div className="flex flex-wrap gap-4">
        {/* Title */}
        <h2
          id="move-to-folder-modal-title"
          className="w-full text-2xl font-semibold text-slate-700 dark:text-slate-200"
        >
          Move Assets to Folder
        </h2>

        {/* Scoping checkboxes */}
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

        {/* Summary */}
        {!hasInvalidConstraints && (
          <p className="w-full text-sm text-slate-500">{getSummaryMessage()}</p>
        )}

        {/* Destination picker */}
        <div className="w-full border-t border-t-slate-300 pt-4 dark:border-t-slate-600">
          <p className="mb-2 text-sm font-medium text-slate-600 dark:text-slate-300">
            Destination
          </p>

          <div
            className="flex flex-col gap-1"
            role="radiogroup"
            aria-label="Destination folder"
          >
            {folderOptions.map((option) => {
              const isRoot = option.value === DESTINATION_ROOT;
              const isSelected = selectedDestination === option.value;

              return (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                    option.disabled
                      ? 'cursor-not-allowed opacity-40'
                      : isSelected
                        ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200'
                        : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700/50'
                  }`}
                >
                  {/* Radio */}
                  <div
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-all ${
                      option.disabled
                        ? 'border-slate-300 bg-slate-50'
                        : isSelected
                          ? 'border-sky-700 bg-linear-to-t from-sky-600 to-sky-500 inset-shadow-xs inset-shadow-sky-300'
                          : 'border-slate-400 bg-linear-to-t from-slate-100 to-white inset-shadow-xs inset-shadow-slate-300'
                    }`}
                  >
                    {isSelected && (
                      <div className="h-1.5 w-1.5 rounded-full bg-white shadow-sm shadow-sky-800" />
                    )}
                  </div>
                  <input
                    type="radio"
                    name="destination"
                    value={option.value}
                    checked={isSelected}
                    disabled={option.disabled}
                    onChange={() => setSelectedDestination(option.value)}
                    className="sr-only"
                  />

                  {/* Icon */}
                  {isRoot ? (
                    <HomeIcon
                      className={`h-4 w-4 shrink-0 ${
                        option.isSource ? 'text-indigo-400' : 'text-slate-400'
                      }`}
                    />
                  ) : (
                    <FolderOpenIcon
                      className={`h-4 w-4 shrink-0 ${
                        option.isSource ? 'text-indigo-400' : 'text-slate-400'
                      }`}
                    />
                  )}

                  {/* Label */}
                  <span className="flex-1">{option.label}</span>

                  {/* Source indicator */}
                  {option.isSource && (
                    <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300">
                      source
                    </span>
                  )}

                  {/* Count */}
                  <span className="text-xs text-slate-400 tabular-nums">
                    {option.count}
                  </span>
                </label>
              );
            })}

            {/* New folder option */}
            <label
              className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                isNewFolderMode
                  ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200'
                  : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700/50'
              }`}
            >
              <div
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-all ${
                  isNewFolderMode
                    ? 'border-sky-700 bg-linear-to-t from-sky-600 to-sky-500 inset-shadow-xs inset-shadow-sky-300'
                    : 'border-slate-400 bg-linear-to-t from-slate-100 to-white inset-shadow-xs inset-shadow-slate-300'
                }`}
              >
                {isNewFolderMode && (
                  <div className="h-1.5 w-1.5 rounded-full bg-white shadow-sm shadow-sky-800" />
                )}
              </div>
              <input
                type="radio"
                name="destination"
                value={DESTINATION_NEW}
                checked={isNewFolderMode}
                onChange={() => setSelectedDestination(DESTINATION_NEW)}
                className="sr-only"
              />

              <FolderPlusIcon className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="flex-1">New folder</span>
            </label>

            {/* New folder form */}
            {isNewFolderMode && (
              <div className="flex w-full flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-600 dark:bg-slate-800">
                <div className="flex items-center gap-2">
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor="repeat-count"
                      className="text-xs text-slate-500"
                    >
                      Repeats
                    </label>
                    <input
                      id="repeat-count"
                      type="number"
                      min={1}
                      value={newRepeatCount}
                      onChange={(e) =>
                        setNewRepeatCount(
                          Math.max(1, parseInt(e.target.value) || 1),
                        )
                      }
                      className={`w-16 rounded border px-2 py-1 text-sm ${
                        isNewRepeatCountValid
                          ? 'border-slate-300 dark:border-slate-600'
                          : 'border-rose-400'
                      } bg-white dark:bg-slate-700 dark:text-slate-200`}
                    />
                  </div>

                  <span className="cursor-default self-end pb-1.5 text-sm text-slate-500">
                    &times;
                  </span>

                  <div className="flex flex-1 flex-col gap-1">
                    <label
                      htmlFor="folder-label"
                      className="text-xs text-slate-500"
                    >
                      Name
                    </label>
                    <input
                      id="folder-label"
                      type="text"
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      placeholder="e.g. sonic"
                      autoFocus
                      className={`w-full rounded border px-2 py-1 text-sm ${
                        !isNewFolderMode ||
                        newLabel.trim() === '' ||
                        isNewLabelValid
                          ? 'border-slate-300 dark:border-slate-600'
                          : 'border-rose-400'
                      } bg-white dark:bg-slate-700 dark:text-slate-200`}
                    />
                  </div>
                </div>

                {/* Preview */}
                {newLabel.trim() && (
                  <p className="text-xs text-slate-500">
                    Folder name:{' '}
                    <span className="font-mono font-medium text-slate-700 dark:text-slate-300">
                      {newFolderName}
                    </span>
                    {newFolderAlreadyExists && (
                      <span className="ml-2 text-amber-600">
                        (folder exists — assets will be moved into it)
                      </span>
                    )}
                  </p>
                )}

                {/* Validation errors */}
                {newLabel.trim() && !isNewLabelValid && (
                  <p className="text-xs text-rose-600">
                    Name may only contain letters, numbers, and hyphens.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Keep selection checkbox */}
        {hasSelectedAssets && (
          <div className="flex w-full items-center">
            <Checkbox
              isSelected={keepSelection}
              onChange={() => setKeepSelection((v) => !v)}
              label="Keep asset selection after moving"
              ariaLabel="Keep asset selection after moving"
            />
          </div>
        )}

        {/* Collision error */}
        {collisionError && (
          <div className="w-full rounded-md border border-rose-300 bg-rose-50 p-3 dark:border-rose-700 dark:bg-rose-900/30">
            <p className="text-sm font-medium text-rose-700 dark:text-rose-300">
              Cannot move: {collisionError.length}
              {collisionError.length !== 1 ? 'files' : 'file'} would collide in
              the destination folder.
            </p>
            <ul className="mt-1 list-inside list-disc text-xs text-rose-600 dark:text-rose-400">
              {collisionError.slice(0, 10).map((name) => (
                <li key={name}>{name}</li>
              ))}
              {collisionError.length > 10 && (
                <li>and {collisionError.length - 10} more...</li>
              )}
            </ul>
          </div>
        )}

        {/* Move errors (partial failure) */}
        {moveErrors && (
          <div className="w-full rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-900/30">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
              {moveErrors.length} {moveErrors.length !== 1 ? 'files' : 'file'}{' '}
              could not be moved (file may be in use).
            </p>
            <ul className="mt-1 list-inside list-disc text-xs text-amber-600 dark:text-amber-400">
              {moveErrors.slice(0, 10).map((name) => (
                <li key={name}>{name}</li>
              ))}
              {moveErrors.length > 10 && (
                <li>and {moveErrors.length - 10} more...</li>
              )}
            </ul>
          </div>
        )}

        {/* Progress bar */}
        {isMoving && <ProgressBar size="sm" indeterminate />}

        {/* Action buttons */}
        <div className="flex w-full justify-end gap-2 pt-2">
          <Button
            type="button"
            onClick={onClose}
            color="slate"
            size="md"
            width="lg"
            disabled={isMoving}
          >
            Cancel
          </Button>

          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!isFormValid || isMoving}
            neutralDisabled
            color="sky"
            size="md"
            width="lg"
          >
            <FolderInputIcon className="mr-1 h-4 w-4" />
            {isMoving ? 'Moving...' : 'Move'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
