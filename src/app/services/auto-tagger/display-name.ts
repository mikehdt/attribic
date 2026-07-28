import path from 'path';

import { isSupportedVideoExtension } from '@/app/constants';

/**
 * The name a client can render the processed file under, given the path the
 * batch runner resolved and the project folder it belongs to. Returns the
 * *project-relative* path (forward slashes) — assets in repeat subfolders
 * (`5_concept/img.jpg`) must keep the subfolder or the client's
 * `/api/images/<name>` URL resolves to the project root and 404s. A raw video
 * (passed whole to a video-capable model, so no poster was extracted) returns
 * undefined, as no <img> can display it. Derived from the resolved path rather
 * than rebuilt from the asset so the poster naming convention lives in one
 * place — `ensureVideoPoster`.
 *
 * Without `projectPath` (a reattached batch whose sidecar snapshot predates
 * project tracking) this falls back to the basename, which is only correct
 * for root-level assets.
 *
 * Shared by the live batch stream and the reattach replay so both produce the
 * same thumbnail name for the same image.
 */
export function displayName(
  resolvedPath: string,
  projectPath?: string,
): string | undefined {
  if (isSupportedVideoExtension(path.extname(resolvedPath))) return undefined;
  if (!projectPath) return path.basename(resolvedPath);
  return path.relative(projectPath, resolvedPath).split(path.sep).join('/');
}
