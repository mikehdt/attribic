/**
 * Resolve the `.training` root — the single folder that holds everything the
 * training system writes: saved projects, per-job working dirs, the sidecar
 * PID file and the ai-toolkit server log.
 *
 * It lives under the configured `projectsFolder` so runs sit next to the
 * datasets they were trained on, rather than scattered through the app's
 * source checkout. Falls back to `{cwd}/.training` when no projects folder is
 * configured.
 *
 * Server-only — do not import from client components. The Python sidecar
 * mirrors this resolution in `training-sidecar/config.py`; keep the two in
 * step.
 */

import path from 'path';

import { getProjectsFolder } from '@/app/services/config/server-config';

import { resolveLoraOutputDir } from './output-path';

/** `{projectsFolder}/.training`, or `{cwd}/.training` when unconfigured. */
export function getTrainingRoot(): string {
  const projectsFolder = getProjectsFolder();
  return path.join(projectsFolder || process.cwd(), '.training');
}

/** Per-job working directories written by the sidecar's job manager. */
export function getTrainingJobsDir(): string {
  return path.join(getTrainingRoot(), 'jobs');
}

/** Saved training projects — one folder per project id. */
export function getTrainingProjectsDir(): string {
  return path.join(getTrainingRoot(), 'projects');
}

/**
 * Where trained LoRAs land. Prefers the shared `loras` folder off the
 * projects folder; only when nothing is configured does it fall back inside
 * the training root.
 */
export function getLoraOutputRoot(): string {
  return (
    resolveLoraOutputDir(getProjectsFolder()) ??
    path.join(getTrainingRoot(), 'outputs')
  );
}
