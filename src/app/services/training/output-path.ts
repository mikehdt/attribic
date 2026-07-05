/**
 * Resolve the directory trained LoRAs are written to.
 *
 * Kept isomorphic (no Node `path`) so the UI can show the same location the
 * request builder sends to the sidecar. Returns null when there's nothing to
 * anchor to (no dataset or no configured projects folder) — the request
 * builder substitutes its own `.training/outputs` fallback in that case.
 */
export function resolveLoraOutputDir(
  projectsFolder: string | null | undefined,
  firstDatasetFolder: string | null | undefined,
): string | null {
  if (!projectsFolder || !firstDatasetFolder) return null;
  // Match the separator the configured path already uses (Windows backslashes
  // or POSIX forward slashes) so the displayed path reads naturally.
  const sep = projectsFolder.includes('\\') ? '\\' : '/';
  const base = projectsFolder.replace(/[\\/]+$/, '');
  return `${base}${sep}${firstDatasetFolder}${sep}loras`;
}
