'use client';

import { FolderIcon, ImagePlusIcon } from 'lucide-react';

import { Button } from '@/app/shared/button';
import { Dropdown } from '@/app/shared/dropdown';
import { FormTitle } from '@/app/shared/form-title/form-title';
import { Modal } from '@/app/shared/modal';
import { ProgressBar } from '@/app/shared/progress-bar/progress-bar';
import type { ImportSkipReason } from '@/app/utils/asset-import';

import type { DroppedFile } from './read-dropped-files';
import { useAssetImportModal } from './use-asset-import-modal';

type AssetImportModalProps = {
  isOpen: boolean;
  onClose: () => void;
  /** Files gathered from a drop or the file picker, awaiting confirmation. */
  candidates: DroppedFile[];
  /** Whether files are currently being dragged over the window. */
  isDragging: boolean;
  onChooseFiles: () => void;
};

/** How many skipped files to name before collapsing into a count. */
const SKIPPED_PREVIEW_LIMIT = 6;

const SKIP_REASONS: Record<ImportSkipReason, string> = {
  exists: 'already in the project',
  duplicate: 'same name twice in this drop',
  unsupported: 'unsupported file type',
  orphaned: 'no matching image in this drop',
};

const plural = (count: number): string => (count === 1 ? '' : 's');

export const AssetImportModal = ({
  isOpen,
  onClose,
  candidates,
  isDragging,
  onChooseFiles,
}: AssetImportModalProps) => {
  const {
    plan,
    groups,
    destination,
    setDestination,
    subfolderOptions,
    showDestination,
    isImporting,
    progress,
    error,
    handleImport,
  } = useAssetImportModal({ isOpen, onClose, candidates });

  // Nothing gathered yet — opened from the project menu, which has no drop zone
  // of its own nearby. Dropping onto this is handled by the window listener in
  // AssetImportHost, so the panel only has to look like a target.
  const isCollecting = plan.assets.length === 0 && plan.skipped.length === 0;

  const showGroups =
    groups.length > 1 || groups.some((group) => group.detected);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="max-w-xl min-w-80"
      preventClose={isImporting}
      labelledById="asset-import-title"
    >
      <div className="flex flex-wrap gap-4">
        <h2
          id="asset-import-title"
          className="w-full text-2xl font-semibold text-slate-700 dark:text-slate-200"
        >
          Add Images
        </h2>

        <p className="w-full text-sm text-slate-500 dark:text-slate-400">
          Files are copied into the project folder. Anything already there is
          kept as it is.
        </p>

        {isImporting ? (
          <div className="w-full">
            <ProgressBar
              value={progress}
              max={plan.assets.length}
              size="md"
              color="sky"
            />
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Importing {progress} of {plan.assets.length}&hellip;
            </p>
          </div>
        ) : isCollecting ? (
          <div
            className={`flex w-full flex-col items-center gap-3 rounded-xl border-4 border-dashed px-6 py-10 text-center transition-colors ${
              isDragging
                ? 'border-sky-400 bg-sky-50 dark:bg-sky-950/30'
                : 'border-slate-300 dark:border-slate-600'
            }`}
          >
            <ImagePlusIcon
              className={`h-12 w-12 ${
                isDragging
                  ? 'text-sky-500'
                  : 'text-slate-400 dark:text-slate-500'
              }`}
            />
            <p className="text-slate-600 dark:text-slate-300">
              {isDragging
                ? 'Drop them here'
                : 'Drag images or folders in from anywhere'}
            </p>
            <Button onClick={onChooseFiles} color="sky" size="md" width="xl">
              Choose Files&hellip;
            </Button>
          </div>
        ) : (
          <>
            <p className="w-full text-slate-700 dark:text-slate-200">
              <span className="text-lg font-semibold">
                {plan.assets.length}
              </span>{' '}
              file{plural(plan.assets.length)} ready to import
            </p>

            {showDestination && (
              <div className="flex w-full flex-col gap-1">
                {/* A span, not a label — the dropdown trigger is a button and
                    carries its own accessible name. */}
                <FormTitle as="span">Destination</FormTitle>
                <Dropdown<string | null>
                  items={[
                    { value: null, label: 'Project root' },
                    ...subfolderOptions.map((subfolder) => ({
                      value: subfolder,
                      label: subfolder,
                    })),
                  ]}
                  selectedValue={destination}
                  onChange={setDestination}
                  aria-label="Destination folder"
                  size="md"
                  fullWidth
                />
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Where files land unless they were dropped inside a repeat
                  folder.
                </p>
              </div>
            )}

            {showGroups && (
              <ul className="w-full divide-y divide-slate-100 text-sm dark:divide-slate-700">
                {groups.map((group) => (
                  <li
                    key={group.subfolder || '__root__'}
                    className="flex items-center gap-2 py-1.5 text-slate-600 dark:text-slate-300"
                  >
                    <FolderIcon className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
                    <span className="font-medium">
                      {group.subfolder || 'Project root'}
                    </span>
                    <span className="text-slate-500 dark:text-slate-400">
                      {group.count} file{plural(group.count)}
                      {group.detected ? ' — from the dropped folder' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {plan.skipped.length > 0 && (
              <div className="w-full rounded-md bg-amber-50 px-3 py-2 dark:bg-amber-950/40">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                  {plan.skipped.length} file{plural(plan.skipped.length)} will
                  be skipped
                </p>
                <ul className="mt-1 text-sm text-amber-700 dark:text-amber-300">
                  {plan.skipped.slice(0, SKIPPED_PREVIEW_LIMIT).map((skip) => (
                    <li key={skip.relativePath} className="truncate">
                      {skip.relativePath} — {SKIP_REASONS[skip.reason]}
                    </li>
                  ))}
                  {plan.skipped.length > SKIPPED_PREVIEW_LIMIT && (
                    <li>
                      &hellip;and {plan.skipped.length - SKIPPED_PREVIEW_LIMIT}{' '}
                      more
                    </li>
                  )}
                </ul>
              </div>
            )}

            {error && (
              <p className="w-full text-sm text-rose-600 dark:text-rose-400">
                {error}
              </p>
            )}

            <div className="flex w-full justify-end gap-2 pt-2">
              <Button onClick={onClose} color="slate" size="md" width="lg">
                Cancel
              </Button>
              <Button
                onClick={handleImport}
                disabled={plan.assets.length === 0}
                neutralDisabled
                color="sky"
                size="md"
                width="xl"
              >
                <ImagePlusIcon />
                Import {plan.assets.length} File{plural(plan.assets.length)}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};
