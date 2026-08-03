import type { DownloadableModel } from './types';

/**
 * Given the directory where a downloadable model was installed and its
 * registry entry, return the path the training form should store in its
 * component field.
 *
 * Single-file downloads (Flux checkpoints, T5-XXL, etc.) resolve to the
 * actual file path. Multi-file bundles — diffusers pipelines like Z-Image
 * that ship transformer/text_encoder/vae as separate files under one
 * directory — don't have a single "model file", so we return the parent
 * directory instead.
 *
 * Uses the registry's default file list, so a variant install with a
 * different layout may resolve wrongly — the server-computed `resolvedPath`
 * (from the download manifest) is authoritative when available; this is
 * the client-side fallback.
 */
export function resolveDownloadedPath(
  dir: string,
  downloadable: DownloadableModel,
): string {
  const files = downloadable.files;
  if (files.length === 1) {
    return joinPath(dir, files[0].name);
  }
  return dir;
}

function joinPath(dir: string, file: string): string {
  const usesBackslash = dir.includes('\\') && !dir.includes('/');
  const sep = usesBackslash ? '\\' : '/';
  const normalizedFile = file.replace(/[/\\]/g, sep);
  const trimmed = dir.endsWith(sep) ? dir.slice(0, -1) : dir;
  return `${trimmed}${sep}${normalizedFile}`;
}
