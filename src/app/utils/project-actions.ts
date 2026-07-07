'use server';

import fs from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

import {
  isSupportedAssetExtension,
  isSupportedImageExtension,
} from '@/app/constants';
import type { AutoTaggerSettings } from '@/app/services/auto-tagger';

import { isValidRepeatFolder, parseSubfolder } from './subfolder-utils';

// Server-side config reading function
const getServerConfig = () => {
  try {
    const configPath = path.join(process.cwd(), 'config.json');
    if (fs.existsSync(configPath)) {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configContent);
      return {
        projectsFolder: config.projectsFolder || 'public/assets',
      };
    }
  } catch (error) {
    console.warn('Failed to read server config:', error);
  }

  // Return defaults if config reading fails
  return {
    projectsFolder: 'public/assets',
  };
};

export type ProjectConfig = {
  title?: string;
  color?: 'slate' | 'rose' | 'amber' | 'teal' | 'sky' | 'indigo' | 'stone';
  thumbnail?: boolean;
  thumbnailVersion?: number;
  hidden?: boolean;
  featured?: boolean;
  autoTagger?: AutoTaggerSettings;
  captionMode?: 'tags' | 'sentences' | 'caption';
  triggerPhrases?: string[];
};

type CentralizedProjectInfo = ProjectConfig;

type LocalProjectInfo = {
  private?: boolean;
};

export type Project = {
  name: string;
  path: string;
  imageCount?: number;
  title?: string;
  color?: 'slate' | 'rose' | 'amber' | 'teal' | 'sky' | 'indigo' | 'stone';
  thumbnail?: string;
  thumbnailVersion?: number;
  hidden?: boolean;
  private?: boolean;
  featured?: boolean;
  captionMode?: 'tags' | 'sentences' | 'caption';
  triggerPhrases?: string[];
};

/**
 * Find thumbnail file for a project based on project name
 * Looks for [project-name].[ext] in /public/tagging-projects/ folder
 */
const findThumbnailFile = (projectName: string): string | undefined => {
  try {
    const projectsDir = path.join(process.cwd(), 'public', 'tagging-projects');
    const supportedExtensions = ['.jpg', '.jpeg', '.png', '.webp'];

    for (const ext of supportedExtensions) {
      const thumbnailPath = path.join(projectsDir, `${projectName}${ext}`);
      if (fs.existsSync(thumbnailPath)) {
        return `${projectName}${ext}`;
      }
    }

    return undefined;
  } catch (error) {
    console.warn(`Error finding thumbnail for ${projectName}:`, error);
    return undefined;
  }
};

/**
 * Read centralized project info from /public/tagging-projects/[project-name].json
 */
const readCentralizedProjectInfo = (
  projectName: string,
): CentralizedProjectInfo | null => {
  try {
    const centralConfigPath = path.join(
      process.cwd(),
      'public',
      'tagging-projects',
      `${projectName}.json`,
    );

    if (!fs.existsSync(centralConfigPath)) {
      return null;
    }

    const configContent = fs.readFileSync(centralConfigPath, 'utf-8');
    const config = JSON.parse(configContent) as CentralizedProjectInfo;

    return config;
  } catch (error) {
    console.warn(
      `Error reading centralized project info for ${projectName}:`,
      error,
    );
    return null;
  }
};

/**
 * Read local project info from [project-folder]/_project.json
 * Only supports private flag
 */
const readLocalProjectInfo = (projectPath: string): LocalProjectInfo | null => {
  try {
    const localConfigPath = path.join(projectPath, '_project.json');

    if (!fs.existsSync(localConfigPath)) {
      return null;
    }

    const configContent = fs.readFileSync(localConfigPath, 'utf-8');
    const config = JSON.parse(configContent) as LocalProjectInfo;

    // Only return private flag - ignore any other properties
    return {
      private: config.private || false,
    };
  } catch (error) {
    console.warn(`Error reading local project info for ${projectPath}:`, error);
    return null;
  }
};

/**
 * Get display info for a single project by folder name.
 * Used to resolve titles/thumbnails when navigating directly via URL.
 */
export const getProjectInfo = async (
  folderName: string,
): Promise<{
  title: string;
  thumbnail?: string;
  captionMode?: 'tags' | 'sentences' | 'caption';
  triggerPhrases?: string[];
} | null> => {
  try {
    const centralInfo = readCentralizedProjectInfo(folderName);
    const thumbnail = findThumbnailFile(folderName);
    return {
      title: centralInfo?.title || folderName,
      thumbnail: thumbnail || undefined,
      captionMode: centralInfo?.captionMode,
      triggerPhrases: centralInfo?.triggerPhrases,
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

        // Read centralized project info first (takes precedence)
        const centralizedInfo = readCentralizedProjectInfo(folder.name);

        // Read local project info for privacy setting
        const localInfo = readLocalProjectInfo(projectPath);

        // Combine configuration with centralized taking precedence
        const isPrivate = localInfo?.private || false;
        const isHidden = centralizedInfo?.hidden || isPrivate;

        // Find thumbnail file if thumbnail is enabled
        const thumbnailFile = centralizedInfo?.thumbnail
          ? findThumbnailFile(folder.name)
          : undefined;

        return {
          name: folder.name,
          path: projectPath,
          imageCount,
          title: centralizedInfo?.title,
          color: centralizedInfo?.color,
          thumbnail: thumbnailFile,
          thumbnailVersion: centralizedInfo?.thumbnailVersion,
          hidden: isHidden,
          private: isPrivate,
          featured: centralizedInfo?.featured || false,
          captionMode: centralizedInfo?.captionMode,
          triggerPhrases: centralizedInfo?.triggerPhrases,
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

    const projectsDir = path.join(process.cwd(), 'public', 'tagging-projects');
    const configPath = path.join(projectsDir, `${projectName}.json`);

    // Ensure the projects directory exists
    if (!fs.existsSync(projectsDir)) {
      fs.mkdirSync(projectsDir, { recursive: true });
    }

    let config: ProjectConfig = {};

    // Read existing config if it exists
    if (fs.existsSync(configPath)) {
      try {
        const configContent = fs.readFileSync(configPath, 'utf-8');
        config = JSON.parse(configContent);
      } catch (error) {
        console.error(
          `Error reading existing config for ${projectName}:`,
          error,
        );
        // Continue with empty config if parsing fails
      }
    }

    // Update the config with new values
    const updatedConfig = {
      ...config,
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

    // If config is empty, remove the file
    if (Object.keys(updatedConfig).length === 0) {
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }
    } else {
      // Write the updated config
      fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2));
    }

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
  thumbnail: string;
  thumbnailVersion: number;
}> => {
  try {
    const projectsDir = path.join(process.cwd(), 'public', 'tagging-projects');

    // Ensure the projects directory exists
    if (!fs.existsSync(projectsDir)) {
      fs.mkdirSync(projectsDir, { recursive: true });
    }

    // Remove any existing thumbnail files for this project
    const supportedExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
    for (const ext of supportedExtensions) {
      const existingPath = path.join(projectsDir, `${projectName}${ext}`);
      if (fs.existsSync(existingPath)) {
        fs.unlinkSync(existingPath);
      }
    }

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

    // Output as PNG for consistent quality
    const thumbnailFilename = `${projectName}.png`;
    const thumbnailPath = path.join(projectsDir, thumbnailFilename);

    await image
      .extract({ left, top, width: size, height: size })
      .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE)
      .png()
      .toFile(thumbnailPath);

    // Update the project config to enable thumbnail with version for cache-busting
    const thumbnailVersion = Date.now();
    await updateProject(projectName, { thumbnail: true, thumbnailVersion });

    return { success: true, thumbnail: thumbnailFilename, thumbnailVersion };
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
    const projectsDir = path.join(process.cwd(), 'public', 'tagging-projects');

    // Remove any existing thumbnail files for this project
    const supportedExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
    for (const ext of supportedExtensions) {
      const existingPath = path.join(projectsDir, `${projectName}${ext}`);
      if (fs.existsSync(existingPath)) {
        fs.unlinkSync(existingPath);
      }
    }

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
    const config = readCentralizedProjectInfo(projectName);
    return config?.autoTagger || null;
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

type ProjectFolderDetail = {
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
 * Scan all images in a project and return a dimension histogram.
 * Uses sharp metadata (header-only reads) so this is fast even for
 * hundreds of images. Returns e.g. { "1920x1080": 15, "1024x768": 8 }.
 */
export const getProjectDimensionHistogram = async (
  projectName: string,
): Promise<Record<string, number>> => {
  const config = getServerConfig();
  const projectPath = path.join(config.projectsFolder, projectName);
  if (!fs.existsSync(projectPath)) return {};

  // Collect all image file paths (root + repeat subfolders)
  const imagePaths: string[] = [];
  const entries = fs.readdirSync(projectPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isFile() && isSupportedImageExtension(path.extname(entry.name))) {
      imagePaths.push(path.join(projectPath, entry.name));
    }
    if (entry.isDirectory() && isValidRepeatFolder(entry.name)) {
      try {
        const subdirPath = path.join(projectPath, entry.name);
        for (const file of fs.readdirSync(subdirPath)) {
          if (isSupportedImageExtension(path.extname(file))) {
            imagePaths.push(path.join(subdirPath, file));
          }
        }
      } catch {
        // Skip unreadable subfolders
      }
    }
  }

  // Read dimensions in parallel (header-only, fast)
  const results = await Promise.all(
    imagePaths.map(async (filePath) => {
      try {
        const meta = await sharp(filePath).metadata();
        if (meta.width && meta.height) return `${meta.width}x${meta.height}`;
      } catch {
        // Skip unreadable files
      }
      return null;
    }),
  );

  const histogram: Record<string, number> = {};
  for (const key of results) {
    if (key) histogram[key] = (histogram[key] ?? 0) + 1;
  }
  return histogram;
};
