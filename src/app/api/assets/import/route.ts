import fs from 'node:fs';
import path from 'node:path';

import { NextResponse } from 'next/server';

import { isSupportedAssetExtension } from '@/app/constants';
import {
  fileIdForTargetPath,
  type ImportSkipReason,
  isSafeTargetPath,
  normaliseImportPath,
  splitSidecarName,
} from '@/app/utils/asset-import';
import { isValidRepeatFolder } from '@/app/utils/subfolder-utils';

/** Reads `projectsFolder` from config.json — the same source as the rest of the app. */
const getProjectsFolder = (): string => {
  try {
    const configPath = path.join(process.cwd(), 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (typeof config.projectsFolder === 'string' && config.projectsFolder) {
        return config.projectsFolder;
      }
    }
  } catch (error) {
    console.warn('Failed to read config.json for asset import:', error);
  }
  return 'public/assets';
};

/** A project slug is one folder name directly inside the projects folder. */
const isSafeProjectSlug = (slug: string): boolean =>
  !!slug &&
  !slug.includes('/') &&
  !slug.includes('\\') &&
  slug !== '.' &&
  slug !== '..';

/**
 * Asset identities already on disk — the project root plus its repeat folders,
 * which is the same shape the asset loader walks. Sidecars are ignored so a
 * `clip.poster.jpg` doesn't register as an asset called `clip.poster`.
 */
const readExistingFileIds = (projectDir: string): Set<string> => {
  const ids = new Set<string>();

  const addFrom = (dir: string, prefix: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      console.warn(`Failed to read ${dir} while importing:`, error);
      return;
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (splitSidecarName(entry.name)) continue;

      const dot = entry.name.lastIndexOf('.');
      if (dot === -1) continue;
      if (!isSupportedAssetExtension(entry.name.slice(dot).toLowerCase())) {
        continue;
      }

      ids.add(`${prefix}${entry.name.slice(0, dot)}`.toLowerCase());
    }
  };

  addFrom(projectDir, '');

  try {
    for (const entry of fs.readdirSync(projectDir, { withFileTypes: true })) {
      if (entry.isDirectory() && isValidRepeatFolder(entry.name)) {
        addFrom(path.join(projectDir, entry.name), `${entry.name}/`);
      }
    }
  } catch (error) {
    console.warn(`Failed to scan repeat folders in ${projectDir}:`, error);
  }

  return ids;
};

type SkippedFile = { path: string; reason: ImportSkipReason };

/**
 * POST — copy dropped files into a project folder.
 *
 * Bytes have to travel over HTTP even though this is a local app: the browser
 * never exposes a dropped file's real path, so there is nothing to copy from.
 * The client sends parallel `path`/`file` fields in matching order, and uploads
 * in batches so a large drop doesn't buffer in one request.
 */
export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (error) {
    console.error('Failed to parse import upload:', error);
    return NextResponse.json({ error: 'Malformed upload' }, { status: 400 });
  }

  const project = String(formData.get('project') ?? '');
  if (!isSafeProjectSlug(project)) {
    return NextResponse.json({ error: 'Invalid project' }, { status: 400 });
  }

  const projectDir = path.resolve(getProjectsFolder(), project);
  if (!fs.existsSync(projectDir)) {
    return NextResponse.json(
      { error: 'Project folder not found' },
      { status: 404 },
    );
  }

  const files = formData.getAll('file');
  const paths = formData.getAll('path').map(String);
  if (files.length !== paths.length) {
    return NextResponse.json(
      { error: 'Mismatched file and path fields' },
      { status: 400 },
    );
  }

  const existing = readExistingFileIds(projectDir);
  const writtenIds = new Set<string>();
  const written: string[] = [];
  const skipped: SkippedFile[] = [];
  const errors: string[] = [];

  const entries = paths.map((value, index) => {
    const targetPath = normaliseImportPath(value);
    return {
      targetPath,
      file: files[index],
      isSidecar:
        splitSidecarName(targetPath.slice(targetPath.lastIndexOf('/') + 1)) !==
        null,
    };
  });

  // Assets before sidecars: a sidecar is only written once its asset has landed,
  // so whatever order the client sent them in can't strand one.
  const ordered = [
    ...entries.filter((entry) => !entry.isSidecar),
    ...entries.filter((entry) => entry.isSidecar),
  ];

  for (const entry of ordered) {
    const { targetPath, file, isSidecar } = entry;

    if (!(file instanceof File)) {
      errors.push(targetPath);
      continue;
    }

    if (!isSafeTargetPath(targetPath)) {
      console.warn(`Rejected import target path: ${targetPath}`);
      errors.push(targetPath);
      continue;
    }

    const absolutePath = path.resolve(projectDir, targetPath);
    if (!absolutePath.startsWith(projectDir + path.sep)) {
      console.warn(
        `Rejected import escaping the project folder: ${targetPath}`,
      );
      errors.push(targetPath);
      continue;
    }

    const key = fileIdForTargetPath(targetPath).toLowerCase();

    if (isSidecar) {
      // Tags and caches follow their asset. If the asset was skipped, so is this.
      if (!writtenIds.has(key)) {
        skipped.push({ path: targetPath, reason: 'orphaned' });
        continue;
      }
    } else if (existing.has(key)) {
      skipped.push({ path: targetPath, reason: 'exists' });
      continue;
    } else if (writtenIds.has(key)) {
      skipped.push({ path: targetPath, reason: 'duplicate' });
      continue;
    }

    try {
      await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.promises.writeFile(
        absolutePath,
        Buffer.from(await file.arrayBuffer()),
      );

      written.push(targetPath);
      if (!isSidecar) writtenIds.add(key);
    } catch (error) {
      console.error(`Failed to import ${targetPath}:`, error);
      errors.push(targetPath);
    }
  }

  return NextResponse.json({ written, skipped, errors });
}
