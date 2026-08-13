/**
 * Server-side helpers for reading values from config.json.
 *
 * Server-only — do not import from client components.
 */

import fs from 'fs';
import path from 'path';

function getConfigPath(): string {
  return path.join(process.cwd(), 'config.json');
}

function readConfig(): Record<string, unknown> {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

/** Read the user's HuggingFace API token from disk, if set. */
export function getHfToken(): string | null {
  const config = readConfig();
  const token = config.hfToken;
  return typeof token === 'string' && token.trim() !== '' ? token : null;
}

/**
 * The bundled projects folder, used when config.json names none. Kept here so
 * every server-side reader agrees on it — the literal was repeated at six call
 * sites, each free to drift.
 */
const DEFAULT_PROJECTS_FOLDER = 'public/assets';

/**
 * Read the configured projects folder, or '' when unset. Prefer
 * {@link getProjectsFolderOrDefault} unless you specifically need to know
 * whether the user has configured one.
 */
export function getProjectsFolder(): string {
  const pf = readConfig().projectsFolder;
  return typeof pf === 'string' ? pf : '';
}

/** The configured projects folder, falling back to the bundled one. */
export function getProjectsFolderOrDefault(): string {
  return getProjectsFolder() || DEFAULT_PROJECTS_FOLDER;
}

/**
 * Whether the training sidecar should be spawned automatically when the app
 * loads. Defaults to true — only an explicit `false` in config.json disables
 * the warm-up. Manual starts from the global menu ignore this.
 */
export function getStartSidecarOnLaunch(): boolean {
  return readConfig().startSidecarOnLaunch !== false;
}

/** Read the configured models folder, defaulting to `<cwd>/public/models`. */
export function getModelsFolder(): string {
  const mf = readConfig().modelsFolder;
  if (typeof mf === 'string' && mf) return mf;
  return path.join(process.cwd(), 'public', 'models');
}
