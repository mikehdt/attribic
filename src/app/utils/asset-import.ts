// Planning rules for importing dropped files into a tagging project.
//
// Shared by the import UI and the import route so the plan the user confirms in
// the summary is derived the same way as the plan that gets written. The route
// still re-checks against disk — it is the authority on what is already there —
// but agreeing on the rules keeps the summary honest.

import { isSupportedAssetExtension } from '@/app/constants';

import { isValidRepeatFolder } from './subfolder-utils';

/**
 * Suffixes that belong to an asset rather than standing on their own. Ordered
 * longest-first so `.poster.jpg` wins over `.jpg` — otherwise a dataset that
 * already has video posters would import them as separate images.
 */
const SIDECAR_SUFFIXES = ['.poster.jpg', '.txt', '.npz'] as const;

type ImportCandidate = {
  /** Path relative to the drop root, e.g. `2_chara/cat.png`. */
  relativePath: string;
  size: number;
};

export type ImportSkipReason =
  /** Not an image, video or recognised sidecar. */
  | 'unsupported'
  /** An asset of the same identity is already in the project. */
  | 'exists'
  /** A second file of the same identity in this same drop. */
  | 'duplicate'
  /** A sidecar whose asset isn't part of this import. */
  | 'orphaned';

type ImportSidecar = {
  relativePath: string;
  /** Path written to, relative to the project folder. */
  targetPath: string;
};

export type PlannedImport = {
  relativePath: string;
  /** Repeat subfolder the asset lands in, or null for the project root. */
  subfolder: string | null;
  /** True when the subfolder came from the dropped folder structure. */
  detected: boolean;
  /** Path written to, relative to the project folder. */
  targetPath: string;
  /** The app's asset identity: `subfolder/basename`, no extension. */
  fileId: string;
  size: number;
  sidecars: ImportSidecar[];
};

type SkippedImport = {
  relativePath: string;
  reason: ImportSkipReason;
};

export type ImportPlan = {
  assets: PlannedImport[];
  skipped: SkippedImport[];
};

/** Normalise a dropped path to forward slashes with no leading `./` or `/`. */
export const normaliseImportPath = (relativePath: string): string =>
  relativePath.replace(/\\/g, '/').replace(/^\.?\//, '');

/** Last segment of a normalised relative path. */
const fileNameOf = (relativePath: string): string =>
  relativePath.slice(relativePath.lastIndexOf('/') + 1);

/** Lowercased extension including the dot, or '' when there isn't one. */
const extensionOf = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot).toLowerCase();
};

/**
 * Split a sidecar file name into the asset base it belongs to and its suffix,
 * or null when the name isn't a sidecar at all.
 */
export const splitSidecarName = (
  fileName: string,
): { base: string; suffix: string } | null => {
  const lower = fileName.toLowerCase();
  for (const suffix of SIDECAR_SUFFIXES) {
    if (lower.endsWith(suffix) && lower.length > suffix.length) {
      return { base: fileName.slice(0, -suffix.length), suffix };
    }
  }
  return null;
};

/**
 * Find the repeat folder a dropped file sits in, so dragging in a prepared
 * `2_chara` folder lands in `2_chara` rather than the project root. The deepest
 * match wins, which flattens any nesting into the nearest repeat ancestor.
 */
const detectRepeatFolder = (relativePath: string): string | null => {
  const segments = normaliseImportPath(relativePath).split('/');
  segments.pop(); // the file name itself
  for (let i = segments.length - 1; i >= 0; i--) {
    if (isValidRepeatFolder(segments[i])) return segments[i];
  }
  return null;
};

/** Asset identity for a target path — the sidecar suffix or extension removed. */
export const fileIdForTargetPath = (targetPath: string): string => {
  const slash = targetPath.lastIndexOf('/');
  const prefix = slash === -1 ? '' : targetPath.slice(0, slash + 1);
  const fileName = targetPath.slice(slash + 1);

  const sidecar = splitSidecarName(fileName);
  if (sidecar) return `${prefix}${sidecar.base}`;

  const dot = fileName.lastIndexOf('.');
  return `${prefix}${dot === -1 ? fileName : fileName.slice(0, dot)}`;
};

/** Control codes are invalid in a path segment; checked without a regex. */
const hasControlChar = (value: string): boolean =>
  Array.from(value).some((char) => char.charCodeAt(0) < 32);

/**
 * Guard for a path about to be written: at most one repeat folder plus a plain
 * file name, and nothing that could climb out of the project folder. The client
 * builds these paths, so the writer re-validates rather than trusting them.
 */
export const isSafeTargetPath = (targetPath: string): boolean => {
  const segments = targetPath.split('/');
  if (segments.length > 2) return false;

  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') return false;
    if (/[\\:*?"<>|]/.test(segment) || hasControlChar(segment)) return false;
  }

  if (segments.length === 2 && !isValidRepeatFolder(segments[0])) return false;

  const fileName = segments[segments.length - 1];
  return (
    isSupportedAssetExtension(extensionOf(fileName)) ||
    splitSidecarName(fileName) !== null
  );
};

type PlanImportArgs = {
  candidates: ImportCandidate[];
  /** Asset identities already in the project, e.g. `cat`, `2_chara/cat`. */
  existingFileIds: string[];
  /** Where files with no detected repeat folder land — null for the root. */
  destination: string | null;
};

/**
 * Work out what a drop would actually write.
 *
 * Collisions are resolved in favour of what's already there: the incoming file
 * is discarded and reported, which avoids silent double-ups when the same
 * images are dragged in from two different folders. Identity is the fileId
 * (path minus extension), not the file name — tags live in `<fileId>.txt`, so
 * two assets sharing a fileId would fight over one sidecar.
 */
export const planImport = ({
  candidates,
  existingFileIds,
  destination,
}: PlanImportArgs): ImportPlan => {
  // Lowercased throughout: NTFS treats `Cat.png` and `cat.png` as one file.
  const existing = new Set(existingFileIds.map((id) => id.toLowerCase()));
  const claimed = new Set<string>();
  const byFileId = new Map<string, PlannedImport>();

  const assets: PlannedImport[] = [];
  const skipped: SkippedImport[] = [];
  const pendingSidecars: Array<ImportSidecar & { fileId: string }> = [];

  for (const candidate of candidates) {
    const relativePath = normaliseImportPath(candidate.relativePath);
    const fileName = fileNameOf(relativePath);
    const detected = detectRepeatFolder(relativePath);
    const subfolder = detected ?? destination;
    const prefix = subfolder ? `${subfolder}/` : '';

    // Sidecars are held back until their asset's fate is known.
    const sidecar = splitSidecarName(fileName);
    if (sidecar) {
      pendingSidecars.push({
        relativePath,
        targetPath: `${prefix}${sidecar.base}${sidecar.suffix}`,
        fileId: `${prefix}${sidecar.base}`,
      });
      continue;
    }

    if (!isSupportedAssetExtension(extensionOf(fileName))) {
      skipped.push({ relativePath, reason: 'unsupported' });
      continue;
    }

    const fileId = `${prefix}${fileName.slice(0, fileName.lastIndexOf('.'))}`;
    const key = fileId.toLowerCase();

    if (existing.has(key)) {
      skipped.push({ relativePath, reason: 'exists' });
      continue;
    }
    if (claimed.has(key)) {
      skipped.push({ relativePath, reason: 'duplicate' });
      continue;
    }
    claimed.add(key);

    const planned: PlannedImport = {
      relativePath,
      subfolder,
      detected: detected !== null,
      targetPath: `${prefix}${fileName}`,
      fileId,
      size: candidate.size,
      sidecars: [],
    };
    assets.push(planned);
    byFileId.set(key, planned);
  }

  // A sidecar only rides along where its asset is part of this import. A stray
  // `.txt` would either land orphaned or overwrite the tags of an asset already
  // in the project, and existing tags are never overwritten.
  for (const sidecar of pendingSidecars) {
    const owner = byFileId.get(sidecar.fileId.toLowerCase());
    if (owner) {
      owner.sidecars.push({
        relativePath: sidecar.relativePath,
        targetPath: sidecar.targetPath,
      });
    } else {
      skipped.push({ relativePath: sidecar.relativePath, reason: 'orphaned' });
    }
  }

  return { assets, skipped };
};
