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
 * Read the configured projects folder, or '' when unset. Callers that need a
 * concrete fallback (e.g. the image server's `public/assets`) apply their own.
 */
export function getProjectsFolder(): string {
  const pf = readConfig().projectsFolder;
  return typeof pf === 'string' ? pf : '';
}

/** Read the configured models folder, defaulting to `<cwd>/public/models`. */
export function getModelsFolder(): string {
  const mf = readConfig().modelsFolder;
  if (typeof mf === 'string' && mf) return mf;
  return path.join(process.cwd(), 'public', 'models');
}
