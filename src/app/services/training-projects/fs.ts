/**
 * Filesystem helpers for saved training projects.
 *
 * Projects are stored under `{projectsFolder}/.training/projects/{id}/`
 * with one `meta.json` plus `v{N}.json` per version. If no projectsFolder
 * is configured, falls back to `{cwd}/.training/projects/`.
 *
 * Versions are numbered from 1 and do not need to be contiguous — deleting
 * a middle version is allowed and creates gaps. `latestVersion` on meta
 * always points to the highest existing version number.
 */

import fs from 'fs/promises';
import path from 'path';

import { getProjectsFolder } from '@/app/services/config/server-config';
import type { FormState } from '@/app/store/training-config/types';

import type {
  TrainingProjectMeta,
  TrainingProjectSummary,
  TrainingProjectVersion,
} from './disk-schema';

// --- Path helpers ---

export function getTrainingProjectsRoot(): string {
  const pf = getProjectsFolder();
  const base = pf || path.join(process.cwd(), '.training-fallback');
  return path.join(base, '.training', 'projects');
}

/**
 * Guard against path traversal. Project ids are minted as UUIDs, so a valid id
 * is always a single safe path segment. Anything else (slashes, `..`, absolute
 * paths, null bytes) must never reach the fs.rm / unlink calls below.
 */
function assertSafeId(id: string): void {
  if (
    !id ||
    id === '.' ||
    id === '..' ||
    id !== path.basename(id) ||
    !/^[A-Za-z0-9._-]+$/.test(id)
  ) {
    throw new Error(`Invalid training project id: ${JSON.stringify(id)}`);
  }
}

function projectDir(id: string): string {
  assertSafeId(id);
  return path.join(getTrainingProjectsRoot(), id);
}

function metaPath(id: string): string {
  return path.join(projectDir(id), 'meta.json');
}

function versionPath(id: string, version: number): string {
  return path.join(projectDir(id), `v${version}.json`);
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// --- Meta I/O ---

async function readMeta(id: string): Promise<TrainingProjectMeta | null> {
  try {
    const raw = await fs.readFile(metaPath(id), 'utf8');
    return JSON.parse(raw) as TrainingProjectMeta;
  } catch {
    return null;
  }
}

async function writeMeta(meta: TrainingProjectMeta): Promise<void> {
  await ensureDir(projectDir(meta.id));
  await fs.writeFile(metaPath(meta.id), JSON.stringify(meta, null, 2), 'utf8');
}

// --- Version I/O ---

async function readVersion(
  id: string,
  version: number,
): Promise<TrainingProjectVersion | null> {
  try {
    const raw = await fs.readFile(versionPath(id, version), 'utf8');
    return JSON.parse(raw) as TrainingProjectVersion;
  } catch {
    return null;
  }
}

/**
 * Strip fields derived from the files on disk rather than chosen by the user.
 *
 * `dimensionHistogram` is a snapshot of the image sizes in a project folder.
 * Persisting it means a config saved today keeps asserting yesterday's sizes
 * after the folder changes, with nothing to invalidate it — and those sizes
 * drive the native-resolution mismatch warning, so a stale copy can quietly
 * claim a dataset is clean when it isn't. It's cheap to rescan (header-only
 * reads), so it's re-derived on load instead of stored.
 */
function stripDerived(form: FormState): FormState {
  return {
    ...form,
    datasets: form.datasets.map((dataset) => {
      const stripped = { ...dataset };
      delete stripped.dimensionHistogram;
      return stripped;
    }),
  };
}

async function writeVersion(
  id: string,
  data: TrainingProjectVersion,
): Promise<void> {
  await ensureDir(projectDir(id));
  await fs.writeFile(
    versionPath(id, data.version),
    JSON.stringify({ ...data, form: stripDerived(data.form) }, null, 2),
    'utf8',
  );
}

/** Scan a project dir for all v{N}.json files, sorted ascending. */
async function listVersionNumbers(id: string): Promise<number[]> {
  const dir = projectDir(id);
  if (!(await pathExists(dir))) return [];
  const entries = await fs.readdir(dir);
  const versions: number[] = [];
  for (const name of entries) {
    const m = /^v(\d+)\.json$/.exec(name);
    if (m) versions.push(Number.parseInt(m[1]!, 10));
  }
  versions.sort((a, b) => a - b);
  return versions;
}

// --- Public API ---

export async function listProjects(): Promise<TrainingProjectSummary[]> {
  const root = getTrainingProjectsRoot();
  if (!(await pathExists(root))) return [];

  const ids = await fs.readdir(root);
  const summaries: TrainingProjectSummary[] = [];

  for (const id of ids) {
    const meta = await readMeta(id);
    if (!meta) continue;

    const versionNumbers = await listVersionNumbers(id);
    const versions: TrainingProjectSummary['versions'] = [];
    for (const n of versionNumbers) {
      const v = await readVersion(id, n);
      if (v) {
        versions.push({
          version: v.version,
          label: v.label,
          savedAt: v.savedAt,
          modelId: v.form.modelId,
          selectedProvider: v.form.selectedProvider,
          // Older saves predate `datasets`; treat a missing list as empty.
          datasets: (v.form.datasets ?? []).map((d) => ({
            projectName: d.projectName,
            thumbnail: d.thumbnail,
            thumbnailVersion: d.thumbnailVersion,
          })),
        });
      }
    }
    summaries.push({ ...meta, versions });
  }

  summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return summaries;
}

export async function loadProject(
  id: string,
  version?: number,
): Promise<{
  meta: TrainingProjectMeta;
  version: TrainingProjectVersion;
} | null> {
  const meta = await readMeta(id);
  if (!meta) return null;
  const target = version ?? meta.latestVersion;
  const v = await readVersion(id, target);
  if (!v) return null;
  return { meta, version: v };
}

/** Create a new project with v1 containing the given form. */
export async function createProject(
  name: string,
  form: FormState,
  label: string | null = null,
): Promise<{ meta: TrainingProjectMeta; version: TrainingProjectVersion }> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const meta: TrainingProjectMeta = {
    id,
    name: name.trim(),
    createdAt: now,
    updatedAt: now,
    latestVersion: 1,
  };

  const version: TrainingProjectVersion = {
    version: 1,
    label: label?.trim() || null,
    savedAt: now,
    form,
  };

  await writeMeta(meta);
  await writeVersion(id, version);
  return { meta, version };
}

/**
 * Append a new version to an existing project. Returns the written version
 * and the updated meta.
 */
export async function addVersion(
  id: string,
  form: FormState,
  label: string | null = null,
): Promise<{
  meta: TrainingProjectMeta;
  version: TrainingProjectVersion;
} | null> {
  const meta = await readMeta(id);
  if (!meta) return null;

  const existing = await listVersionNumbers(id);
  const next = (existing.at(-1) ?? 0) + 1;
  const now = new Date().toISOString();

  const version: TrainingProjectVersion = {
    version: next,
    label: label?.trim() || null,
    savedAt: now,
    form,
  };

  const updatedMeta: TrainingProjectMeta = {
    ...meta,
    latestVersion: next,
    updatedAt: now,
  };

  await writeVersion(id, version);
  await writeMeta(updatedMeta);
  return { meta: updatedMeta, version };
}

/**
 * Overwrite an existing version in place. Used by the plain "Save" action
 * when a version is loaded and dirty. The version's savedAt is bumped;
 * label can be updated or preserved.
 */
export async function overwriteVersion(
  id: string,
  version: number,
  form: FormState,
  label?: string | null,
): Promise<{
  meta: TrainingProjectMeta;
  version: TrainingProjectVersion;
} | null> {
  const meta = await readMeta(id);
  if (!meta) return null;

  const existing = await readVersion(id, version);
  if (!existing) return null;

  const now = new Date().toISOString();
  const nextVersion: TrainingProjectVersion = {
    version,
    label: label === undefined ? existing.label : label?.trim() || null,
    savedAt: now,
    form,
  };

  const updatedMeta: TrainingProjectMeta = { ...meta, updatedAt: now };

  await writeVersion(id, nextVersion);
  await writeMeta(updatedMeta);
  return { meta: updatedMeta, version: nextVersion };
}

/**
 * Replace a project entirely: delete all existing versions and start fresh
 * at v1 with the given form. Meta id and createdAt are preserved; name can
 * optionally be changed.
 */
export async function replaceProject(
  id: string,
  form: FormState,
  options: { name?: string; label?: string | null } = {},
): Promise<{
  meta: TrainingProjectMeta;
  version: TrainingProjectVersion;
} | null> {
  const meta = await readMeta(id);
  if (!meta) return null;

  const dir = projectDir(id);
  const entries = await fs.readdir(dir);
  await Promise.all(
    entries
      .filter((n) => /^v\d+\.json$/.test(n))
      .map((n) => fs.unlink(path.join(dir, n))),
  );

  const now = new Date().toISOString();
  const updatedMeta: TrainingProjectMeta = {
    ...meta,
    name: options.name?.trim() || meta.name,
    updatedAt: now,
    latestVersion: 1,
  };

  const version: TrainingProjectVersion = {
    version: 1,
    label: options.label?.trim() || null,
    savedAt: now,
    form,
  };

  await writeMeta(updatedMeta);
  await writeVersion(id, version);
  return { meta: updatedMeta, version };
}

export async function renameProject(
  id: string,
  name: string,
): Promise<TrainingProjectMeta | null> {
  const meta = await readMeta(id);
  if (!meta) return null;
  const updated: TrainingProjectMeta = {
    ...meta,
    name: name.trim(),
    updatedAt: new Date().toISOString(),
  };
  await writeMeta(updated);
  return updated;
}

export async function setVersionLabel(
  id: string,
  version: number,
  label: string | null,
): Promise<TrainingProjectVersion | null> {
  const existing = await readVersion(id, version);
  if (!existing) return null;
  const updated: TrainingProjectVersion = {
    ...existing,
    label: label?.trim() || null,
  };
  await writeVersion(id, updated);
  return updated;
}

export async function deleteProject(id: string): Promise<boolean> {
  const dir = projectDir(id);
  if (!(await pathExists(dir))) return false;
  await fs.rm(dir, { recursive: true, force: true });
  return true;
}

/**
 * Delete a single version file. Refuses to delete the last remaining
 * version — callers should delete the whole project instead.
 * If the deleted version was the latest, recomputes meta.latestVersion.
 */
export async function deleteVersion(
  id: string,
  version: number,
): Promise<TrainingProjectMeta | null> {
  const meta = await readMeta(id);
  if (!meta) return null;

  const existing = await listVersionNumbers(id);
  if (existing.length <= 1) return null;
  if (!existing.includes(version)) return null;

  await fs.unlink(versionPath(id, version));

  const remaining = existing.filter((v) => v !== version);
  const updated: TrainingProjectMeta = {
    ...meta,
    latestVersion: remaining.at(-1) ?? meta.latestVersion,
    updatedAt: new Date().toISOString(),
  };
  await writeMeta(updated);
  return updated;
}
