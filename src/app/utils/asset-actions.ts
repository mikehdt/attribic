'use server';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createReadStream } from 'node:fs';
import path from 'node:path';

import { imageDimensionsFromStream } from 'image-dimensions';

import {
  isSupportedAssetExtension,
  isSupportedVideoExtension,
} from '@/app/constants';

import {
  type ImageAsset,
  ImageDimensions,
  IoState,
  TagState,
} from '../store/assets';
import { splitHybrid } from '../store/assets/hybrid-caption';
import type { CaptionMode } from '../store/project/types';
import { calculateKohyaBucket, KOHYA_CONFIGS } from './image-utils';
import { getProjectCaptionMode } from './project-actions';
import { sharp } from './sharp';
import { isValidRepeatFolder } from './subfolder-utils';

/**
 * Get the current data path - either from provided project path or default
 */
const getCurrentDataPath = async (projectPath?: string): Promise<string> => {
  if (!projectPath) {
    return 'public/assets';
  }

  // Check if the projectPath is already a full absolute path
  if (path.isAbsolute(projectPath)) {
    return projectPath;
  }

  // If it's not absolute, treat it as a project name and construct the full path
  try {
    const configPath = path.join(process.cwd(), 'config.json');
    if (fs.existsSync(configPath)) {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configContent);
      const projectsFolder = config.projectsFolder || 'public/assets';
      const fullPath = path.join(projectsFolder, projectPath);

      // Protect against edge case: if projects folder is default but constructed path doesn't exist,
      // fall back to just the default path
      if (projectsFolder === 'public/assets' && !fs.existsSync(fullPath)) {
        console.warn(
          `Project path ${fullPath} does not exist, falling back to default assets folder`,
        );
        return 'public/assets';
      }

      return fullPath;
    }
  } catch (error) {
    console.warn('Failed to read config, using default:', error);
  }

  // Fallback to default if config reading fails or constructed path doesn't exist
  const fallbackPath = path.join('public/assets', projectPath);
  if (!fs.existsSync(fallbackPath)) {
    console.warn(
      `Fallback project path ${fallbackPath} does not exist, using default assets folder`,
    );
    return 'public/assets';
  }

  return fallbackPath;
};

/**
 * Helper function to detect duplicate fileIds and return filtered results
 * Now handles subfolder paths - only detects duplicates within the same folder context
 * @param files Array of image filenames (may include subfolder paths like "2_sonic/image.jpg")
 * @returns Object with unique files and any duplicate warnings
 */
const detectDuplicateFileIds = (
  files: string[],
): {
  uniqueFiles: string[];
  duplicateWarnings: string[];
} => {
  const fileIdMap = new Map<string, string[]>();

  // Group files by their full fileId including folder path (but without extension)
  files.forEach((file) => {
    const fileId = file.substring(0, file.lastIndexOf('.'));
    if (!fileIdMap.has(fileId)) {
      fileIdMap.set(fileId, []);
    }
    fileIdMap.get(fileId)!.push(file);
  });

  const uniqueFiles: string[] = [];
  const duplicateWarnings: string[] = [];

  // Process each group and identify duplicates
  fileIdMap.forEach((filesGroup, fileId) => {
    if (filesGroup.length > 1) {
      duplicateWarnings.push(
        `Duplicate fileId "${fileId}" found in files: ${filesGroup.join(', ')}. Using: ${filesGroup[0]}`,
      );
      uniqueFiles.push(filesGroup[0]); // Use the first file found
    } else {
      uniqueFiles.push(filesGroup[0]);
    }
  });

  return { uniqueFiles, duplicateWarnings };
};

export type ImageFileListErrorType = 'not_found' | 'read_error';

export interface ImageFileListResult {
  files: string[];
  error?: string;
  errorType?: ImageFileListErrorType;
}

// Filename suffix used for video poster sidecars (e.g. `clip.mp4` →
// `clip.poster.jpg`). Declared at the top of the file so discovery filters
// can reference it without forward-declaration warnings.
const POSTER_SIDECAR_SUFFIX = '.poster.jpg';

// Returns just a list of image files without processing them
// Includes images from root folder and valid repeat subfolders
export const getImageFileList = async (
  projectPath?: string,
): Promise<ImageFileListResult> => {
  const dataPath = await getCurrentDataPath(projectPath);
  // Use the path directly if it's absolute, otherwise resolve it relative to cwd
  const dir = path.isAbsolute(dataPath) ? dataPath : path.resolve(dataPath);

  const allImageFiles: string[] = [];

  // 1. Get images from root directory
  let rootEntries: fs.Dirent[];
  try {
    rootEntries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    const isNotFound =
      error instanceof Error && 'code' in error && error.code === 'ENOENT';
    const errorMessage = isNotFound
      ? `Project folder not found: ${dir}`
      : `Unable to read project folder: ${dir}`;
    console.error(errorMessage, error);
    return {
      files: [],
      error: errorMessage,
      errorType: isNotFound ? 'not_found' : 'read_error',
    };
  }

  const rootImages = rootEntries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((file) => isSupportedAssetExtension(path.extname(file)))
    .filter((file) => !file.toLowerCase().endsWith(POSTER_SIDECAR_SUFFIX));

  allImageFiles.push(...rootImages);

  // 2. Get images from valid repeat subfolders
  const subdirectories = rootEntries.filter((entry) => entry.isDirectory());

  for (const subdir of subdirectories) {
    const subdirName = subdir.name;

    // Check if this is a valid repeat folder
    if (!isValidRepeatFolder(subdirName)) {
      // Skip invalid folders silently
      continue;
    }

    try {
      const subdirPath = path.join(dir, subdirName);
      const subdirFiles = fs.readdirSync(subdirPath);

      const subdirImages = subdirFiles
        .filter((file) => isSupportedAssetExtension(path.extname(file)))
        .filter((file) => !file.toLowerCase().endsWith(POSTER_SIDECAR_SUFFIX))
        .map((file) => `${subdirName}/${file}`); // Store with relative path

      allImageFiles.push(...subdirImages);
    } catch (error) {
      console.warn(`Failed to read subfolder ${subdirName}:`, error);
    }
  }

  // Check for duplicate fileIds (same base name with different extensions)
  const { uniqueFiles, duplicateWarnings } =
    detectDuplicateFileIds(allImageFiles);

  // Log warnings if any duplicates were found
  if (duplicateWarnings.length > 0) {
    console.warn('File naming conflicts detected:');
    duplicateWarnings.forEach((warning) => console.warn(warning));
  }

  return { files: uniqueFiles };
};

/**
 * Cached per-asset derived data (blur placeholders for images, dimensions for
 * videos). Keyed by fileId; the lastModified stamp is the cache validity check.
 */
export type BlurCache = {
  [fileId: string]: {
    lastModified: number;
    blurDataUrl?: string;
    videoDimensions?: ImageDimensions;
  };
};

/**
 * Process multiple image files at once and return their asset data
 * @param files Array of files to process
 * @param projectPath Optional project path, uses default if not provided
 * @param blurCache Optional cache of blur data from previous load
 * @returns Array of image assets and tracking of failed files
 */
export const getMultipleImageAssetDetails = async (
  files: string[],
  projectPath?: string,
  blurCache?: BlurCache,
): Promise<{ assets: ImageAsset[]; errors: string[] }> => {
  // Check for duplicate fileIds and get filtered files
  const { uniqueFiles, duplicateWarnings } = detectDuplicateFileIds(files);

  // Convert duplicate warnings to error format for return
  const duplicateErrors = duplicateWarnings.map(
    (warning) => `FILE_NAMING_CONFLICT: ${warning}`,
  );

  // Log warnings about duplicates
  if (duplicateWarnings.length > 0) {
    console.warn('File naming conflicts detected in batch processing:');
    duplicateWarnings.forEach((warning) => console.warn(warning));
  }

  // Resolve the caption mode once for the whole batch — server-side, from the
  // project config, so parsing can't race the client's config hydration.
  const captionMode = await getProjectCaptionMode(projectPath);

  const results = await Promise.allSettled(
    uniqueFiles.map((file) =>
      loadAssetDetails(file, projectPath, blurCache, captionMode),
    ),
  );

  const assets: ImageAsset[] = [];
  const errors: string[] = [...duplicateErrors]; // Start with duplicate errors

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      assets.push(result.value);
    } else {
      // Store the filename for failed loads
      errors.push(uniqueFiles[index]);
      console.error(
        `Failed to load asset ${uniqueFiles[index]}:`,
        result.reason,
      );
    }
  });

  return { assets, errors };
};

const BLUR_MAX_DIMENSION = 10;

const VIDEO_FALLBACK_DIMENSIONS: ImageDimensions = {
  width: 1920,
  height: 1080,
};
const POSTER_FRAME_FRACTION = 0.1; // 10% into the video
let warnedMissingFfprobe = false;
let warnedMissingFfmpeg = false;

type VideoProbe = {
  dimensions: ImageDimensions;
  /** Duration in seconds, or undefined if unreadable */
  durationSec?: number;
};

/**
 * Probe a video file for its native pixel dimensions and duration using
 * system ffprobe. Returns a 16:9 fallback (and no duration) if ffprobe isn't
 * installed or the probe fails — the gallery still works, just with an
 * inaccurate aspect ratio and no poster extraction.
 */
const probeVideo = (filePath: string): Promise<VideoProbe> => {
  return new Promise((resolve) => {
    const proc = spawn(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height:format=duration',
        '-of',
        'json',
        filePath,
      ],
      { windowsHide: true },
    );

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      if (!warnedMissingFfprobe) {
        warnedMissingFfprobe = true;
        console.warn(
          `ffprobe not available — video dimensions will fall back to 16:9. Install ffmpeg to fix. (${err.message})`,
        );
      }
      resolve({ dimensions: VIDEO_FALLBACK_DIMENSIONS });
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        console.warn(
          `ffprobe failed for ${filePath} (exit ${code}): ${stderr.trim()}`,
        );
        resolve({ dimensions: VIDEO_FALLBACK_DIMENSIONS });
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as {
          streams?: { width?: number; height?: number }[];
          format?: { duration?: string };
        };
        const stream = parsed.streams?.[0];
        const dimensions =
          stream?.width && stream?.height
            ? { width: stream.width, height: stream.height }
            : VIDEO_FALLBACK_DIMENSIONS;
        const durationRaw = parsed.format?.duration;
        const durationSec = durationRaw ? Number(durationRaw) : undefined;
        resolve({
          dimensions,
          durationSec: Number.isFinite(durationSec) ? durationSec : undefined,
        });
      } catch (err) {
        console.warn(`Failed to parse ffprobe output for ${filePath}:`, err);
        resolve({ dimensions: VIDEO_FALLBACK_DIMENSIONS });
      }
    });
  });
};

/**
 * Build the poster sidecar path for a given video file path
 * (e.g. `clip.mp4` → `clip.poster.jpg`). Internal helper — kept non-exported
 * because server-actions modules require all exports to be async.
 */
const buildPosterPath = (videoPath: string): string => {
  const ext = path.extname(videoPath);
  const base = videoPath.substring(0, videoPath.length - ext.length);
  return `${base}${POSTER_SIDECAR_SUFFIX}`;
};

/**
 * Extract a single poster frame from a video at ~10% in, save it next to the
 * video as `<name>.poster.jpg`, and return the poster path. Reuses an existing
 * poster if it's newer than the video. Returns null if extraction fails or
 * ffmpeg isn't available — callers should treat null as "skip this asset".
 */
export const ensureVideoPoster = async (
  videoPath: string,
): Promise<string | null> => {
  const posterPath = buildPosterPath(videoPath);

  try {
    const videoStat = fs.statSync(videoPath);
    if (fs.existsSync(posterPath)) {
      const posterStat = fs.statSync(posterPath);
      if (posterStat.mtimeMs >= videoStat.mtimeMs) {
        return posterPath;
      }
    }
  } catch (err) {
    console.warn(`Failed to stat video ${videoPath} for poster:`, err);
    return null;
  }

  const probe = await probeVideo(videoPath);
  // Seek to 10% in, but cap at duration - 0.1s to avoid landing past the end
  // on very short clips. Falls back to 0s if duration is unknown.
  let seekSec = 0;
  if (probe.durationSec && probe.durationSec > 0) {
    seekSec = Math.max(
      0,
      Math.min(
        probe.durationSec * POSTER_FRAME_FRACTION,
        probe.durationSec - 0.1,
      ),
    );
  }

  return new Promise((resolve) => {
    const proc = spawn(
      'ffmpeg',
      [
        '-y',
        '-ss',
        seekSec.toFixed(3),
        '-i',
        videoPath,
        '-frames:v',
        '1',
        '-q:v',
        '3',
        posterPath,
      ],
      { windowsHide: true },
    );

    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      if (!warnedMissingFfmpeg) {
        warnedMissingFfmpeg = true;
        console.warn(
          `ffmpeg not available — videos cannot be auto-tagged. Install ffmpeg to fix. (${err.message})`,
        );
      }
      resolve(null);
    });

    proc.on('close', (code) => {
      if (code !== 0 || !fs.existsSync(posterPath)) {
        console.warn(
          `ffmpeg poster extraction failed for ${videoPath} (exit ${code}): ${stderr.trim().slice(-300)}`,
        );
        resolve(null);
        return;
      }
      resolve(posterPath);
    });
  });
};

/**
 * Generate a tiny blur placeholder image as a base64 data URL.
 * The image is resized to fit within 10x10 pixels while maintaining aspect ratio.
 */
const generateBlurDataUrl = async (
  filePath: string,
): Promise<string | undefined> => {
  try {
    const buffer = await sharp(filePath)
      .resize(BLUR_MAX_DIMENSION, BLUR_MAX_DIMENSION, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 90 })
      .toBuffer();

    return `data:image/jpeg;base64,${buffer.toString('base64')}`;
  } catch (error) {
    console.warn(`Failed to generate blur placeholder for ${filePath}:`, error);
    return undefined;
  }
};

// Process a single image file and return its asset data. The caption mode is
// resolved server-side from the project config (see getProjectCaptionMode).
export const getImageAssetDetails = async (
  file: string,
  projectPath?: string,
  blurCache?: BlurCache,
): Promise<ImageAsset> => {
  const captionMode = await getProjectCaptionMode(projectPath);
  return loadAssetDetails(file, projectPath, blurCache, captionMode);
};

const loadAssetDetails = async (
  file: string,
  projectPath: string | undefined,
  blurCache: BlurCache | undefined,
  captionMode: CaptionMode,
): Promise<ImageAsset> => {
  const fileId = file.substring(0, file.lastIndexOf('.'));
  const fileExtension = file.substring(file.lastIndexOf('.') + 1);
  const currentDataPath = await getCurrentDataPath(projectPath);

  // Extract subfolder if present (file may be "2_sonic/image.jpg" or just "image.jpg")
  let subfolder: string | undefined;
  const slashIndex = file.indexOf('/');
  if (slashIndex !== -1) {
    subfolder = file.substring(0, slashIndex);
  }

  const fullFilePath = path.join(currentDataPath, file);

  // Get file stats for last modified time
  const stats = fs.statSync(fullFilePath);
  const lastModified = Math.floor(stats.mtime.getTime() / 1000); // Unix timestamp in seconds

  const isVideo = isSupportedVideoExtension(`.${fileExtension}`);
  const cachedEntry = blurCache?.[fileId];
  const canUseCache = cachedEntry?.lastModified === lastModified;

  // Videos: probe dimensions via ffprobe (cached across reloads), skip blur.
  // Poster frames will come later.
  let dimensions: ImageDimensions;
  let blurDataUrl: string | undefined;

  if (isVideo) {
    dimensions =
      (canUseCache ? cachedEntry?.videoDimensions : undefined) ??
      (await probeVideo(fullFilePath)).dimensions;
    blurDataUrl = undefined;
  } else {
    // @ts-expect-error ReadableStream.from being weird
    const stream = ReadableStream.from(createReadStream(fullFilePath));

    // Run dimension reading and blur generation in parallel (skip blur if cached)
    [dimensions, blurDataUrl] = await Promise.all([
      imageDimensionsFromStream(stream) as Promise<ImageDimensions>,
      canUseCache && cachedEntry?.blurDataUrl
        ? Promise.resolve(cachedEntry.blurDataUrl)
        : generateBlurDataUrl(fullFilePath),
    ]);
  }

  // Calculate Kohya bucket for this image (using SDXL 1024 settings)
  const bucket = calculateKohyaBucket(
    dimensions.width,
    dimensions.height,
    KOHYA_CONFIGS.SDXL_1024,
  );

  let tagStatus: { [key: string]: TagState } = {};
  let tagList: string[] = [];
  let captionText = '';

  try {
    // Tag file is co-located with image (in same folder)
    const tagFilePath = path.join(currentDataPath, `${fileId}.txt`);

    // Check if the tag file exists first before trying to read it
    if (fs.existsSync(tagFilePath)) {
      const tagContent = fs.readFileSync(tagFilePath, 'utf8').trim();

      // Parse text into tags/caption based on caption mode. captionText is set
      // to what the caption box should show for THIS mode (empty for pure tag
      // modes), so a later mode switch without a reload doesn't surface stale
      // text — e.g. tags→hybrid must start with an empty caption, not the raw
      // tag string.
      if (tagContent) {
        if (captionMode === 'caption') {
          // Whole file is the caption; no tag list.
          captionText = tagContent;
        } else if (captionMode === 'hybrid') {
          // Split the tag block from the trailing NL caption. Both are
          // populated independently.
          const { tags, caption } = splitHybrid(tagContent);
          captionText = caption;

          tagStatus = tags.reduce(
            (acc, tag) => ({
              ...acc,
              [tag.trim()]: TagState.SAVED,
            }),
            {} as { [key: string]: TagState },
          );

          tagList = Object.keys(tagStatus);
        } else {
          // Tags / sentences: no caption section.
          const parts =
            captionMode === 'sentences'
              ? // Split on sentence-ending punctuation followed by whitespace
                tagContent.split(/(?<=[.?!])\s+/).filter((s) => s.trim() !== '')
              : // Default: comma-separated tags
                tagContent.split(', ').filter((tag) => tag.trim() !== '');

          tagStatus = parts.reduce(
            (acc, tag) => ({
              ...acc,
              [tag.trim()]: TagState.SAVED,
            }),
            {} as { [key: string]: TagState },
          );

          tagList = Object.keys(tagStatus);
        }
      }
    } else {
      // File doesn't exist - use empty tags but log this info
      console.log(`No tag file found for ${fileId}, using empty tags`);
    }
  } catch (err) {
    // Other errors during read operation
    console.error(`Error reading tags for ${fileId}:`, err);
  }

  return {
    ioState: IoState.COMPLETE,
    fileId,
    fileExtension,
    subfolder,
    dimensions,
    bucket,
    tagStatus,
    tagList,
    savedTagList: [...tagList], // Make a copy of the initial tag list
    captionText,
    savedCaptionText: captionText,
    lastModified,
    blurDataUrl,
  };
};

export const saveAssetTags = async (
  fileId: string,
  composedTags: string,
  projectPath?: string,
): Promise<boolean> => {
  try {
    const currentDataPath = await getCurrentDataPath(projectPath);
    const tagFilePath = path.join(currentDataPath, `${fileId}.txt`);
    fs.writeFileSync(tagFilePath, composedTags);
    return true;
  } catch (err) {
    console.error('Disk I/O error:', err);
    return false;
  }
};

// Export interface for tag write operations
export interface AssetTagOperation {
  fileId: string;
  composedTags: string;
}

/**
 * Write multiple tag sets to disk in a single operation
 * @param operations Array of tag write operations to perform
 * @param projectPath Optional project path, uses default if not provided
 * @returns Result object with success flag, individual results, and list of failed files
 */
export const saveMultipleAssetTags = async (
  operations: AssetTagOperation[],
  projectPath?: string,
): Promise<{
  success: boolean;
  results: { fileId: string; success: boolean }[];
  errors: string[]; // Add list of failed files
}> => {
  // Process all operations in parallel
  const currentDataPath = await getCurrentDataPath(projectPath);
  const results = await Promise.all(
    operations.map(async ({ fileId, composedTags }) => {
      try {
        const tagFilePath = path.join(currentDataPath, `${fileId}.txt`);
        fs.writeFileSync(tagFilePath, composedTags);
        return { fileId, success: true };
      } catch (err) {
        console.error(`Disk I/O error for ${fileId}:`, err);
        return { fileId, success: false };
      }
    }),
  );

  // Collect errors from results
  const errors = results
    .filter((result) => !result.success)
    .map((result) => result.fileId);

  // Overall operation succeeds if all individual writes succeeded
  const success = results.every((result) => result.success);

  return {
    success,
    results,
    errors,
  };
};

// --- Move assets between folders ---

export type MoveAssetOperation = {
  fileId: string;
  fileExtension: string;
};

export type MoveAssetsResult = {
  success: boolean;
  moved: Array<{
    oldFileId: string;
    newFileId: string;
    newSubfolder: string | undefined;
  }>;
  collisions: string[];
  errors: string[];
  deletedFolders: string[];
};

/**
 * Rename a file, retrying on EBUSY/EPERM errors (common on Windows when
 * another process briefly locks the file, e.g. thumbnail caching).
 */
const renameWithRetry = async (
  oldPath: string,
  newPath: string,
  retries = 5,
  delayMs = 200,
): Promise<void> => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await fs.promises.rename(oldPath, newPath);
      return;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if ((code === 'EBUSY' || code === 'EPERM') && attempt < retries) {
        await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
};

/**
 * Extract the basename (filename without subfolder prefix) from a fileId.
 * "2_sonic/image" → "image", "image" → "image"
 */
const getBasename = (fileId: string): string => {
  const slashIndex = fileId.lastIndexOf('/');
  return slashIndex !== -1 ? fileId.substring(slashIndex + 1) : fileId;
};

/**
 * Move assets to a destination folder (or root).
 * @param assets Array of assets to move (fileId + fileExtension)
 * @param destination Target folder name (e.g. "2_sonic"), or null for root
 * @param projectPath Optional project path
 */
export const moveAssetsToFolder = async (
  assets: MoveAssetOperation[],
  destination: string | null,
  projectPath?: string,
): Promise<MoveAssetsResult> => {
  const dataPath = await getCurrentDataPath(projectPath);
  const dir = path.isAbsolute(dataPath) ? dataPath : path.resolve(dataPath);

  // Validate destination folder name
  if (destination !== null && !isValidRepeatFolder(destination)) {
    return {
      success: false,
      moved: [],
      collisions: [],
      errors: [`Invalid folder name: ${destination}`],
      deletedFolders: [],
    };
  }

  // Build move plan, skipping assets already in the destination
  const movePlan: Array<{
    asset: MoveAssetOperation;
    basename: string;
    oldFileId: string;
    newFileId: string;
    newSubfolder: string | undefined;
  }> = [];

  for (const asset of assets) {
    const basename = getBasename(asset.fileId);
    const newFileId = destination ? `${destination}/${basename}` : basename;

    // Skip assets already in the destination
    if (asset.fileId === newFileId) continue;

    movePlan.push({
      asset,
      basename,
      oldFileId: asset.fileId,
      newFileId,
      newSubfolder: destination ?? undefined,
    });
  }

  if (movePlan.length === 0) {
    return {
      success: true,
      moved: [],
      collisions: [],
      errors: [],
      deletedFolders: [],
    };
  }

  // Pre-flight collision check
  const collisions: string[] = [];
  for (const plan of movePlan) {
    const destImagePath = path.join(
      dir,
      `${plan.newFileId}.${plan.asset.fileExtension}`,
    );
    if (fs.existsSync(destImagePath)) {
      collisions.push(plan.basename);
    }
  }

  if (collisions.length > 0) {
    return {
      success: false,
      moved: [],
      collisions,
      errors: [],
      deletedFolders: [],
    };
  }

  // Create destination folder if needed
  if (destination) {
    const destDir = path.join(dir, destination);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
  }

  // Execute moves
  const moved: MoveAssetsResult['moved'] = [];
  const errors: string[] = [];
  const sourceFolders = new Set<string>();

  for (const plan of movePlan) {
    try {
      // Track source folder for cleanup
      const slashIndex = plan.oldFileId.lastIndexOf('/');
      if (slashIndex !== -1) {
        sourceFolders.add(plan.oldFileId.substring(0, slashIndex));
      }

      // Move image file
      const oldImagePath = path.join(
        dir,
        `${plan.oldFileId}.${plan.asset.fileExtension}`,
      );
      const newImagePath = path.join(
        dir,
        `${plan.newFileId}.${plan.asset.fileExtension}`,
      );
      await renameWithRetry(oldImagePath, newImagePath);

      // Move associated sidecar files (.txt tags, .npz cache, .poster.jpg
      // for video assets) if they exist
      for (const ext of ['.txt', '.npz', POSTER_SIDECAR_SUFFIX]) {
        const oldPath = path.join(dir, `${plan.oldFileId}${ext}`);
        const newPath = path.join(dir, `${plan.newFileId}${ext}`);
        if (fs.existsSync(oldPath)) {
          await renameWithRetry(oldPath, newPath);
        }
      }

      moved.push({
        oldFileId: plan.oldFileId,
        newFileId: plan.newFileId,
        newSubfolder: plan.newSubfolder,
      });
    } catch (err) {
      console.error(`Failed to move ${plan.oldFileId}:`, err);
      errors.push(plan.oldFileId);
    }
  }

  // Clean up empty source folders
  const deletedFolders: string[] = [];
  for (const folder of sourceFolders) {
    try {
      const folderPath = path.join(dir, folder);
      if (fs.existsSync(folderPath)) {
        const entries = fs.readdirSync(folderPath);
        if (entries.length === 0) {
          fs.rmdirSync(folderPath);
          deletedFolders.push(folder);
        }
      }
    } catch (err) {
      console.warn(`Failed to clean up folder ${folder}:`, err);
    }
  }

  return {
    success: errors.length === 0,
    moved,
    collisions: [],
    errors,
    deletedFolders,
  };
};
