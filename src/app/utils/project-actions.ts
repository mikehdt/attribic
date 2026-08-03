'use server';

import fs from 'node:fs';
import path from 'node:path';

import {
  isSupportedAssetExtension,
  isSupportedImageExtension,
} from '@/app/constants';
import type { AutoTaggerSettings } from '@/app/services/auto-tagger';
import { getProjectsFolderOrDefault } from '@/app/services/config/server-config';
import type { ProjectConfig } from '@/app/services/tagging-projects/fs';
import {
  deleteThumbnail,
  hasThumbnail,
  readConfig,
  writeConfig,
  writeThumbnail,
} from '@/app/services/tagging-projects/fs';
import type { CaptionMode } from '@/app/store/project/types';

import { validateProjectFolderName } from './project-folder-name';
import { sharp } from './sharp';
import { isValidRepeatFolder, parseSubfolder } from './subfolder-utils';

const getServerConfig = () => ({
  projectsFolder: getProjectsFolderOrDefault(),
});

// `ProjectConfig` is deliberately not re-exported here: the 'use server'
// transform turns even a type-only re-export into a runtime export, which
// throws `ProjectConfig is not defined` on the first server action. Import it
// from the service instead.

export type Project = {
  name: string;
  path: string;
  imageCount?: number;
  title?: string;
  color?: 'slate' | 'rose' | 'amber' | 'teal' | 'sky' | 'indigo' | 'stone';
  /** Whether a thumbnail exists; its path is derived from the project name. */
  thumbnail?: boolean;
  thumbnailVersion?: number;
  hidden?: boolean;
  private?: boolean;
  /** Keeps an asset-less project in the list; see `ProjectConfig`. */
  showWhenEmpty?: boolean;
  featured?: boolean;
  captionMode?: CaptionMode;
  triggerPhrases?: string[];
  captionPrompt?: string;
};

/**
 * Resolve a project's caption mode from its config file on the server.
 *
 * Asset parsing must not trust the client's Redux caption mode: on a hard
 * refresh, assets start loading before the project config has hydrated, and a
 * hybrid file parsed under the default 'tags' mode splits its natural-language
 * caption into junk tags. The config file is the source of truth — mode
 * switches persist to it synchronously with the in-app switch.
 *
 * `projectPath` may be a folder name or an absolute path under projectsFolder.
 */
export const getProjectCaptionMode = async (
  projectPath?: string,
): Promise<CaptionMode> => {
  if (!projectPath) return 'tags';
  const folderName = path.basename(projectPath);
  return readConfig(folderName)?.captionMode ?? 'tags';
};

/**
 * Get display info for a single project by folder name.
 * Used to resolve titles/thumbnails when navigating directly via URL.
 */
export const getProjectInfo = async (
  folderName: string,
): Promise<{
  title: string;
  thumbnail?: boolean;
  thumbnailVersion?: number;
  captionMode?: CaptionMode;
  triggerPhrases?: string[];
  captionPrompt?: string;
} | null> => {
  try {
    const config = readConfig(folderName);

    return {
      title: config?.title || folderName,
      thumbnail: hasThumbnail(folderName),
      thumbnailVersion: config?.thumbnailVersion,
      captionMode: config?.captionMode,
      triggerPhrases: config?.triggerPhrases,
      captionPrompt: config?.captionPrompt,
    };
  } catch {
    return null;
  }
};

/**
 * Get a list of project folders from the projects directory
 * Each project folder should contain image files and associated txt files
 * Private projects are never included, hidden projects are included but filtered client-side
 */
export const getProjectList = async (): Promise<Project[]> => {
  try {
    // Get the current configuration to determine projects folder
    const config = getServerConfig();
    const projectsFolder = config.projectsFolder;

    // Check if the projects folder exists
    if (!fs.existsSync(projectsFolder)) {
      console.warn(`Projects folder does not exist: ${projectsFolder}`);
      return [];
    }

    // Read the directory contents
    const entries = fs.readdirSync(projectsFolder, { withFileTypes: true });

    // Filter to only include directories (project folders)
    const projectFolders = entries.filter((entry) => entry.isDirectory());

    // Map to project objects and count images
    const projects: Project[] = await Promise.all(
      projectFolders.map(async (folder) => {
        const projectPath = path.join(projectsFolder, folder.name);
        let imageCount = 0;

        try {
          // Count image files in the project folder root
          const projectEntries = fs.readdirSync(projectPath, {
            withFileTypes: true,
          });

          // Count assets (images + videos) in root directory
          const rootImageCount = projectEntries
            .filter((entry) => entry.isFile())
            .filter(
              (entry) =>
                isSupportedAssetExtension(path.extname(entry.name)) &&
                !entry.name.toLowerCase().endsWith('.poster.jpg'),
            ).length;

          // Count images in valid repeat subfolders
          const subdirectories = projectEntries.filter((entry) =>
            entry.isDirectory(),
          );
          let subfolderImageCount = 0;

          for (const subdir of subdirectories) {
            const subdirName = subdir.name;
            // Only count images in valid repeat folders
            if (isValidRepeatFolder(subdirName)) {
              try {
                const subdirPath = path.join(projectPath, subdirName);
                const subdirFiles = fs.readdirSync(subdirPath);
                const subdirImages = subdirFiles.filter(
                  (file) =>
                    isSupportedAssetExtension(path.extname(file)) &&
                    !file.toLowerCase().endsWith('.poster.jpg'),
                );
                subfolderImageCount += subdirImages.length;
              } catch (subdirError) {
                console.warn(
                  `Error reading subfolder ${subdirName} in ${projectPath}:`,
                  subdirError,
                );
                // Continue with next subfolder
              }
            }
          }

          imageCount = rootImageCount + subfolderImageCount;
        } catch (error) {
          console.warn(`Error reading project folder ${projectPath}:`, error);
          // Continue with imageCount = 0
        }

        const config = readConfig(folder.name);

        const isPrivate = config?.private || false;
        const isHidden = config?.hidden || isPrivate;

        return {
          name: folder.name,
          path: projectPath,
          imageCount,
          title: config?.title,
          color: config?.color,
          thumbnail: config?.thumbnail ? hasThumbnail(folder.name) : false,
          thumbnailVersion: config?.thumbnailVersion,
          hidden: isHidden,
          private: isPrivate,
          showWhenEmpty: config?.showWhenEmpty || false,
          featured: config?.featured || false,
          captionMode: config?.captionMode,
          triggerPhrases: config?.triggerPhrases,
          captionPrompt: config?.captionPrompt,
        };
      }),
    );

    // Always filter out private projects, but include hidden ones when includeHidden is true
    const visibleProjects = projects.filter((project) => !project.private);

    // Separate featured and regular projects
    const featuredProjects = visibleProjects
      .filter((project) => project.featured)
      .sort((a, b) => (a.title || a.name).localeCompare(b.title || b.name));

    const regularProjects = visibleProjects
      .filter((project) => !project.featured)
      .sort((a, b) => (a.title || a.name).localeCompare(b.title || b.name));

    // Return featured projects first, then regular projects
    return [...featuredProjects, ...regularProjects];
  } catch (error) {
    console.error('Error reading projects folder:', error);
    throw new Error(`Failed to read projects from configured folder`);
  }
};

export type CreateProjectResult =
  { success: true; project: Project } | { success: false; error: string };

/**
 * Create a new tagging project: a folder under the projects root, seeded with a
 * `.tagging` config.
 *
 * The config is what makes the new project visible — the list hides folders
 * with no assets, so `showWhenEmpty` is set to carry it through until the first
 * image arrives.
 *
 * Failures come back as `{ success: false, error }` rather than thrown: these
 * are the user's to fix (bad name, name taken) and the form flags the field
 * with them, whereas a thrown Server Action error is redacted in production.
 */
export const createProject = async (
  folderName: string,
  title?: string,
): Promise<CreateProjectResult> => {
  const name = folderName.trim();

  const nameError = validateProjectFolderName(name);
  if (nameError) return { success: false, error: nameError };

  const { projectsFolder } = getServerConfig();

  if (!fs.existsSync(projectsFolder)) {
    return {
      success: false,
      error: 'The configured projects folder does not exist.',
    };
  }

  // Scanned case-insensitively rather than left to mkdir's EEXIST: NTFS treats
  // "Foo" and "foo" as the same folder, and the clash is worth naming since an
  // existing asset-less folder won't be in the list to explain itself.
  let clash: string | undefined;
  try {
    clash = fs
      .readdirSync(projectsFolder, { withFileTypes: true })
      .find(
        (entry) =>
          entry.isDirectory() &&
          entry.name.toLowerCase() === name.toLowerCase(),
      )?.name;
  } catch (error) {
    console.error('Error reading projects folder:', error);
    return { success: false, error: 'Could not read the projects folder.' };
  }

  if (clash) {
    return {
      success: false,
      error: `A folder named “${clash}” already exists in the projects folder.`,
    };
  }

  const projectPath = path.join(projectsFolder, name);
  const trimmedTitle = title?.trim();

  try {
    fs.mkdirSync(projectPath);
    writeConfig(name, {
      showWhenEmpty: true,
      ...(trimmedTitle ? { title: trimmedTitle } : {}),
    });
  } catch (error) {
    console.error(`Error creating project ${name}:`, error);
    return { success: false, error: 'Could not create the project folder.' };
  }

  return {
    success: true,
    project: {
      name,
      path: projectPath,
      imageCount: 0,
      title: trimmedTitle || undefined,
      showWhenEmpty: true,
    },
  };
};

/**
 * Update a project's configuration
 * Updates the centralized config file in /public/tagging-projects/[project-name].json
 */
export const updateProject = async (
  projectName: string,
  updates: Partial<ProjectConfig>,
): Promise<{ success: boolean; config: ProjectConfig }> => {
  try {
    // Validate the updates
    if (updates.title !== undefined && typeof updates.title !== 'string') {
      throw new Error('Title must be a string');
    }

    if (updates.color !== undefined) {
      const validColors = [
        'slate',
        'rose',
        'amber',
        'teal',
        'sky',
        'indigo',
        'stone',
      ];
      if (!validColors.includes(updates.color)) {
        throw new Error('Invalid color value');
      }
    }

    // Update the config with new values
    const updatedConfig = {
      ...(readConfig(projectName) ?? {}),
      ...updates,
    };

    // Remove undefined values, empty strings, and falsy boolean flags.
    // Every boolean flag (hidden, featured, thumbnail) defaults to false when
    // absent, so writing `false` is redundant — and stripping it lets an
    // unchecked flag actually clear the stored value rather than lingering.
    Object.keys(updatedConfig).forEach((key) => {
      const value = updatedConfig[key as keyof ProjectConfig];
      if (value === undefined || value === '' || value === false) {
        delete updatedConfig[key as keyof ProjectConfig];
      }
    });

    writeConfig(projectName, updatedConfig);

    return { success: true, config: updatedConfig };
  } catch (error) {
    console.error('Error updating project config:', error);
    throw error;
  }
};

const THUMBNAIL_SIZE = 80;

/**
 * Create a thumbnail for a project from an uploaded image
 * Center-crops the image to a square and resizes to 80x80
 */
export const createProjectThumbnail = async (
  projectName: string,
  imageData: ArrayBuffer,
): Promise<{
  success: boolean;
  thumbnailVersion: number;
}> => {
  try {
    // Process the image with sharp - center crop to square, resize to 80x80
    const buffer = Buffer.from(imageData);
    const image = sharp(buffer);
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) {
      throw new Error('Could not read image dimensions');
    }

    // Calculate center crop dimensions
    const size = Math.min(metadata.width, metadata.height);
    const left = Math.floor((metadata.width - size) / 2);
    const top = Math.floor((metadata.height - size) / 2);

    await writeThumbnail(projectName, (destination) =>
      image
        .extract({ left, top, width: size, height: size })
        .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE)
        .png()
        .toFile(destination),
    );

    // Update the project config to enable thumbnail with version for cache-busting
    const thumbnailVersion = Date.now();
    await updateProject(projectName, { thumbnail: true, thumbnailVersion });

    return { success: true, thumbnailVersion };
  } catch (error) {
    console.error('Error creating project thumbnail:', error);
    throw error;
  }
};

/**
 * Remove a project's thumbnail
 */
export const removeProjectThumbnail = async (
  projectName: string,
): Promise<{ success: boolean }> => {
  try {
    deleteThumbnail(projectName);

    // Update the project config to disable thumbnail and clear version
    await updateProject(projectName, {
      thumbnail: false,
      thumbnailVersion: undefined,
    });

    return { success: true };
  } catch (error) {
    console.error('Error removing project thumbnail:', error);
    throw error;
  }
};

/**
 * Get auto-tagger settings for a project
 */
export const getAutoTaggerSettings = async (
  projectName: string,
): Promise<AutoTaggerSettings | null> => {
  try {
    return readConfig(projectName)?.autoTagger || null;
  } catch (error) {
    console.error('Error reading auto-tagger settings:', error);
    return null;
  }
};

/**
 * Save auto-tagger settings for a project
 */
export const saveAutoTaggerSettings = async (
  projectName: string,
  settings: AutoTaggerSettings,
): Promise<{ success: boolean }> => {
  try {
    await updateProject(projectName, { autoTagger: settings });
    return { success: true };
  } catch (error) {
    console.error('Error saving auto-tagger settings:', error);
    throw error;
  }
};

export type ProjectFolderDetail = {
  name: string;
  imageCount: number;
  detectedRepeats: number;
};

/**
 * Get the folder breakdown for a project: root images and repeat subfolders.
 * Used by the training system to build dataset sources.
 */
export const getProjectFolders = async (
  projectName: string,
): Promise<ProjectFolderDetail[]> => {
  const config = getServerConfig();
  const projectPath = path.join(config.projectsFolder, projectName);

  if (!fs.existsSync(projectPath)) return [];

  const entries = fs.readdirSync(projectPath, { withFileTypes: true });
  const folders: ProjectFolderDetail[] = [];

  // Root assets (images + videos)
  const rootImageCount = entries
    .filter((e) => e.isFile())
    .filter(
      (e) =>
        isSupportedAssetExtension(path.extname(e.name)) &&
        !e.name.toLowerCase().endsWith('.poster.jpg'),
    ).length;

  if (rootImageCount > 0) {
    folders.push({
      name: 'Root',
      imageCount: rootImageCount,
      detectedRepeats: 1,
    });
  }

  // Repeat subfolders
  for (const entry of entries) {
    if (!entry.isDirectory() || !isValidRepeatFolder(entry.name)) continue;
    const parsed = parseSubfolder(entry.name);
    if (!parsed) continue;

    try {
      const subdirPath = path.join(projectPath, entry.name);
      const imageCount = fs
        .readdirSync(subdirPath)
        .filter(
          (f) =>
            isSupportedAssetExtension(path.extname(f)) &&
            !f.toLowerCase().endsWith('.poster.jpg'),
        ).length;

      if (imageCount > 0) {
        folders.push({
          name: entry.name,
          imageCount,
          detectedRepeats: parsed.repeatCount,
        });
      }
    } catch {
      // Skip unreadable subfolders
    }
  }

  return folders;
};

/**
 * Scan all images in a project and return a dimension histogram per folder,
 * e.g. `{ Root: { "1920x1080": 15 }, "5_concept": { "1024x768": 8 } }`.
 *
 * Split by folder rather than totalled because a folder can be excluded from a
 * run (repeats set to 0) — a whole-project histogram would keep counting images
 * the run never sees into the bucket preview. Keys match the folder names from
 * {@link getProjectFolders}, `Root` included, so the two line up.
 *
 * Uses sharp metadata (header-only reads) so this is fast even for hundreds of
 * images.
 */
export const getProjectFolderHistograms = async (
  projectName: string,
): Promise<Record<string, Record<string, number>>> => {
  const config = getServerConfig();
  const projectPath = path.join(config.projectsFolder, projectName);
  if (!fs.existsSync(projectPath)) return {};

  // Collect image file paths, tagged with the folder they came from.
  const images: { folder: string; filePath: string }[] = [];
  const entries = fs.readdirSync(projectPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isFile() && isSupportedImageExtension(path.extname(entry.name))) {
      images.push({
        folder: 'Root',
        filePath: path.join(projectPath, entry.name),
      });
    }
    if (entry.isDirectory() && isValidRepeatFolder(entry.name)) {
      try {
        const subdirPath = path.join(projectPath, entry.name);
        for (const file of fs.readdirSync(subdirPath)) {
          if (isSupportedImageExtension(path.extname(file))) {
            images.push({
              folder: entry.name,
              filePath: path.join(subdirPath, file),
            });
          }
        }
      } catch {
        // Skip unreadable subfolders
      }
    }
  }

  // Read dimensions in parallel (header-only, fast)
  const results = await Promise.all(
    images.map(async ({ folder, filePath }) => {
      try {
        const meta = await sharp(filePath).metadata();
        if (meta.width && meta.height) {
          return { folder, key: `${meta.width}x${meta.height}` };
        }
      } catch {
        // Skip unreadable files
      }
      return null;
    }),
  );

  const histograms: Record<string, Record<string, number>> = {};
  for (const result of results) {
    if (!result) continue;
    const histogram = (histograms[result.folder] ??= {});
    histogram[result.key] = (histogram[result.key] ?? 0) + 1;
  }
  return histograms;
};

export type ProjectDatasetScan = {
  /** Whether the project folder still exists under the projects root. */
  exists: boolean;
  /** Root and repeat subfolders as they are on disk right now. */
  folders: ProjectFolderDetail[];
  /**
   * How the project captions its images right now, which decides what a
   * training run can emit from it. Read here rather than stored in the
   * training config: the project can be retagged long after a config is saved.
   */
  captionMode?: CaptionMode;
};

/**
 * Re-scan a project folder that a training config has attached as a dataset.
 *
 * This is the readdir half of a rescan, deliberately kept apart from
 * {@link getProjectFolderHistograms}: this one is a directory listing and
 * returns in microseconds, while the histogram opens every image. The form
 * needs the folder breakdown before it can render a dataset at all, so pairing
 * them would make every project load wait on the slow one.
 *
 * `exists` distinguishes a folder that's been moved or renamed from one that's
 * simply been emptied — both come back with no folders, and only one of them
 * is worth telling the user their dataset is missing.
 */
export const scanDatasetFolders = async (
  projectName: string,
): Promise<ProjectDatasetScan> => {
  const { projectsFolder } = getServerConfig();

  if (!fs.existsSync(path.join(projectsFolder, projectName))) {
    return { exists: false, folders: [] };
  }

  return {
    exists: true,
    folders: await getProjectFolders(projectName),
    captionMode: readConfig(projectName)?.captionMode ?? 'tags',
  };
};
