// Utilities for handling repeat training subfolders

import { naturalCompare } from './helpers';

/**
 * Regex pattern for valid repeat folder names: {number}_{label}
 * Examples: 2_sonic, 3_knuckles, 10_test
 */
const REPEAT_FOLDER_PATTERN = /^(\d+)_([a-zA-Z0-9-]+)$/;

/**
 * App-managed folder holding archived assets. Not a repeat folder — excluded
 * from training datasets, project counts, and import dedupe by the
 * repeat-folder allowlists.
 */
export const ARCHIVE_FOLDER = '.archive';

export const isArchiveSubfolder = (subfolder?: string): boolean =>
  subfolder === ARCHIVE_FOLDER;

/**
 * Check if a folder name matches the repeat folder pattern
 */
export const isValidRepeatFolder = (folderName: string): boolean => {
  return REPEAT_FOLDER_PATTERN.test(folderName);
};

/**
 * Filename portion of a `fileId`, with any subfolder prefix stripped
 * (`2_sonic/abc_image` → `abc_image`). Anything ordering or grouping assets
 * "by name" uses this, so an asset sits where its own name puts it rather than
 * where its folder does.
 */
export const getAssetFileName = (
  fileId: string,
  subfolder?: string,
): string => {
  if (!subfolder) return fileId;
  const slashIndex = fileId.indexOf('/');
  return slashIndex === -1 ? fileId : fileId.substring(slashIndex + 1);
};

/**
 * Order two assets by name alone, ignoring which folder each one lives in.
 * Moving an asset into (or out of) a subfolder must not move it in the gallery
 * when the sort is name-based — folder is what the Folder sort is for.
 *
 * Falls back to the full `fileId` when the bare names match, so two assets that
 * share a filename across folders get a stable, deterministic order instead of
 * whichever way the scan happened to list them.
 */
export const compareAssetNames = (
  a: { fileId: string; subfolder?: string },
  b: { fileId: string; subfolder?: string },
): number => {
  const byName = naturalCompare(
    getAssetFileName(a.fileId, a.subfolder),
    getAssetFileName(b.fileId, b.subfolder),
  );
  return byName !== 0 ? byName : naturalCompare(a.fileId, b.fileId);
};

/**
 * Parse a subfolder name into its repeat count and label components
 * @param subfolder - Folder name (e.g., "2_sonic")
 * @returns Object with repeatCount and label, or null if invalid
 */
export const parseSubfolder = (
  subfolder: string,
): { repeatCount: number; label: string } | null => {
  const match = subfolder.match(REPEAT_FOLDER_PATTERN);
  if (!match) {
    return null;
  }

  const [, countStr, label] = match;
  const repeatCount = parseInt(countStr, 10);

  return {
    repeatCount,
    label,
  };
};
