import fs from 'node:fs';
import path from 'node:path';

import type { AutoTaggerSettings } from '@/app/services/auto-tagger';
import { getProjectsFolder } from '@/app/services/config/server-config';
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
  color?: 'slate' | 'rose' | 'amber' | 'teal' | 'sky' | 'indigo' | 'stone';
  thumbnail?: boolean;
  thumbnailVersion?: number;
  hidden?: boolean;
  /** Never listed at all, as opposed to `hidden` which lists then filters. */
  private?: boolean;
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
  path.resolve(getProjectsFolder() || 'public/assets');

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
 * Write the config, or remove it when nothing is left to store. An emptied
 * config takes its `.tagging` folder with it so projects that were only ever
 * touched once don't leave a stray folder behind.
 */
export const writeConfig = (
  projectName: string,
  config: ProjectConfig,
): void => {
  const dir = getTaggingDir(projectName);
  const configPath = getConfigPath(projectName);

  if (Object.keys(config).length === 0) {
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
    // Only prunes an empty folder; a surviving thumbnail keeps it alive.
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
    }
    return;
  }

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
