import fs from 'node:fs';
import path from 'node:path';

import type { AutoTaggerSettings } from '@/app/services/auto-tagger';
import { getProjectsFolderOrDefault } from '@/app/services/config/server-config';
import type { ProjectColor } from '@/app/shared/project-colors';
import type { CaptionMode } from '@/app/store/project/types';

/**
 * Tagging config rides along inside the project folder it describes, so moving
 * or renaming the folder carries its settings with it. Training projects stay
 * top-level under `.training` — they reference datasets across several folders
 * and so belong to no single one.
 */
const TAGGING_DIR = '.tagging';
const CONFIG_FILE = 'project.json';
const THUMBNAIL_FILE = 'project.png';

export type ProjectConfig = {
  title?: string;
  color?: ProjectColor;
  thumbnail?: boolean;
  thumbnailVersion?: number;
  hidden?: boolean;
  featured?: boolean;
  autoTagger?: AutoTaggerSettings;
  captionMode?: CaptionMode;
  triggerPhrases?: string[];
  /**
   * The project's canonical natural-language captioning prompt. Absent means
   * "never authored" — captioning runs fall back to the built-in default.
   * Only the project menu's prompt modal writes this; a run's per-batch edits
   * are deliberately not persisted here.
   */
  captionPrompt?: string;
};

const getProjectsRoot = (): string =>
  path.resolve(getProjectsFolderOrDefault());

/**
 * Project names arrive from URL slugs and client calls, so a bare folder name
 * is the only acceptable shape — anything with a separator could escape the
 * projects root.
 */
const assertSafeProjectName = (projectName: string): void => {
  if (
    !projectName ||
    projectName !== path.basename(projectName) ||
    projectName === '.' ||
    projectName === '..'
  ) {
    throw new Error(`Invalid project name: ${projectName}`);
  }
};

export const getTaggingDir = (projectName: string): string => {
  assertSafeProjectName(projectName);
  return path.join(getProjectsRoot(), projectName, TAGGING_DIR);
};

const getConfigPath = (projectName: string): string =>
  path.join(getTaggingDir(projectName), CONFIG_FILE);

export const getThumbnailPath = (projectName: string): string =>
  path.join(getTaggingDir(projectName), THUMBNAIL_FILE);

export const readConfig = (projectName: string): ProjectConfig | null => {
  try {
    const configPath = getConfigPath(projectName);
    if (!fs.existsSync(configPath)) return null;
    return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as ProjectConfig;
  } catch (error) {
    console.warn(`Error reading tagging config for ${projectName}:`, error);
    return null;
  }
};

/**
 * Write the config, even when empty. The file's existence is what registers
 * the folder as a tagging project — unregistered folders in the projects root
 * are never listed — so an emptied config is written as `{}` rather than
 * removed.
 */
export const writeConfig = (
  projectName: string,
  config: ProjectConfig,
): void => {
  const dir = getTaggingDir(projectName);
  const configPath = getConfigPath(projectName);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
};

export const hasThumbnail = (projectName: string): boolean => {
  try {
    return fs.existsSync(getThumbnailPath(projectName));
  } catch {
    return false;
  }
};

export const writeThumbnail = async (
  projectName: string,
  write: (destination: string) => Promise<unknown>,
): Promise<void> => {
  fs.mkdirSync(getTaggingDir(projectName), { recursive: true });
  await write(getThumbnailPath(projectName));
};

export const deleteThumbnail = (projectName: string): void => {
  const thumbnailPath = getThumbnailPath(projectName);
  if (fs.existsSync(thumbnailPath)) fs.unlinkSync(thumbnailPath);
};
