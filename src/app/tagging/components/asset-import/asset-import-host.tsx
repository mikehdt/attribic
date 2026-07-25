'use client';

import { ImagePlusIcon } from 'lucide-react';

import { AssetImportModal } from './asset-import-modal';
import { useAssetImportHost } from './use-asset-import-host';

/** File types the picker offers — sidecars included so tags can come along. */
const ACCEPTED_TYPES = '.jpg,.jpeg,.png,.webp,.mp4,.txt';

/**
 * Drop target and importer for the tagging route.
 *
 * Rendered once, above the view gate, so dragging files in works from anywhere
 * on the page — including the empty-project screen — and so the project menu
 * can reach the file picker without the two needing to know about each other.
 */
export const AssetImportHost = () => {
  const {
    isTagging,
    isOpen,
    isDragging,
    candidates,
    fileInputRef,
    handleFilesSelected,
    handleChooseFiles,
    handleClose,
  } = useAssetImportHost();

  if (!isTagging) return null;

  return (
    <>
      {isDragging && !isOpen && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-8 backdrop-blur-xs">
          <div className="flex flex-col items-center gap-3 rounded-xl border-4 border-dashed border-sky-400 bg-white/90 px-12 py-10 text-center dark:bg-slate-800/90">
            <ImagePlusIcon className="h-16 w-16 text-sky-500" />
            <p className="text-xl font-semibold text-slate-700 dark:text-slate-200">
              Drop to import
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Images, videos and whole folders are all accepted
            </p>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPTED_TYPES}
        className="hidden"
        onChange={(e) => handleFilesSelected(e.target.files)}
      />

      <AssetImportModal
        isOpen={isOpen}
        onClose={handleClose}
        candidates={candidates}
        isDragging={isDragging}
        onChooseFiles={handleChooseFiles}
      />
    </>
  );
};
