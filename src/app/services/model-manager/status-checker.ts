/**
 * Check whether a model's files are fully downloaded and ready.
 *
 * Server-only — do not import from client components.
 */

import fs from 'fs';
import path from 'path';

import type { ModelFile, ModelStatus } from './types';

type Manifest = {
  files: { name: string; size: number }[];
};

// Tolerance for size estimate mismatch when no manifest exists (5%).
// GGUF downloads from HF can differ meaningfully from hand-declared sizes.
const SIZE_TOLERANCE = 0.05;

function manifestPathFor(modelDir: string, modelId: string): string {
  return path.join(modelDir, `${modelId}.manifest.json`);
}

/** Load the per-model manifest written by the download engine, if present. */
function loadManifest(modelDir: string, modelId: string): Manifest | null {
  const manifestPath = manifestPathFor(modelDir, modelId);
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    const parsed = JSON.parse(raw) as Manifest;
    if (!parsed.files || !Array.isArray(parsed.files)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Write a manifest from actual on-disk sizes. Self-heals for pre-manifest downloads. */
function writeManifest(
  modelDir: string,
  modelId: string,
  files: ModelFile[],
): void {
  try {
    const manifest: Manifest = { files: [] };
    for (const file of files) {
      const filePath = path.join(modelDir, file.name);
      if (fs.existsSync(filePath)) {
        manifest.files.push({
          name: file.name,
          size: fs.statSync(filePath).size,
        });
      }
    }
    fs.writeFileSync(
      manifestPathFor(modelDir, modelId),
      JSON.stringify(manifest, null, 2),
      'utf-8',
    );
  } catch {
    // best-effort
  }
}

/**
 * File names actually installed for a model, from its manifest. The manifest
 * records what was really downloaded — which may be a variant with a
 * different file layout than the registry default (e.g. an fp8 file instead
 * of fp16). Returns null when no manifest exists.
 */
export function getInstalledFileNames(
  modelDir: string,
  modelId: string,
): string[] | null {
  const manifest = loadManifest(modelDir, modelId);
  if (!manifest || manifest.files.length === 0) return null;
  return manifest.files.map((f) => f.name);
}

/**
 * Check if a model is fully downloaded in `modelDir`.
 *
 * Per-model manifest lookup (`<modelId>.manifest.json`) is the source of
 * truth when present — required because multiple models can share a
 * `modelDir` (e.g. every SDXL checkpoint lives under `public/models/sdxl/`).
 * A shared manifest would make each model report the neighbour's files as
 * its own. The passed-in `files` array is only used when no manifest is
 * present (pre-manifest downloads or hand-placed files), and sizes fall
 * back to tolerance-matching.
 *
 * Returns:
 * - 'ready' if every expected file is present and matches its expected size
 * - 'partial' if some files exist but at least one is missing or wrong
 * - 'not_installed' if no files are present
 */
export function checkModelFiles(
  modelDir: string,
  modelId: string,
  files: ModelFile[],
): ModelStatus {
  if (!fs.existsSync(modelDir)) {
    return 'not_installed';
  }

  const manifest = loadManifest(modelDir, modelId);

  // Manifest wins. It records exactly what was downloaded, which may be
  // a variant with a different file layout than the registry default.
  if (manifest) {
    let anyExists = false;
    let allComplete = true;
    for (const entry of manifest.files) {
      const filePath = path.join(modelDir, entry.name);
      if (!fs.existsSync(filePath)) {
        allComplete = false;
        continue;
      }
      anyExists = true;
      try {
        const stats = fs.statSync(filePath);
        if (stats.size !== entry.size) allComplete = false;
      } catch {
        allComplete = false;
      }
    }
    if (allComplete && anyExists) return 'ready';
    if (anyExists) return 'partial';
    return 'not_installed';
  }

  // No manifest — fall back to the registry's declared file list with
  // size tolerance. Declared sizes for GGUF/HF downloads are often
  // estimates, so we allow a small delta rather than hard-failing.
  let anyExists = false;
  let allComplete = true;
  let inferredComplete = false;

  for (const file of files) {
    const filePath = path.join(modelDir, file.name);

    if (!fs.existsSync(filePath)) {
      allComplete = false;
      continue;
    }

    anyExists = true;

    if (file.size > 0) {
      try {
        const stats = fs.statSync(filePath);
        const delta = Math.abs(stats.size - file.size);
        const within = delta / file.size <= SIZE_TOLERANCE;
        if (!within) {
          allComplete = false;
        } else {
          inferredComplete = true;
        }
      } catch {
        allComplete = false;
      }
    }
  }

  if (allComplete && anyExists) {
    // Self-heal: persist a manifest so future checks are exact and
    // don't depend on the estimate.
    if (inferredComplete) {
      writeManifest(modelDir, modelId, files);
    }
    return 'ready';
  }
  if (anyExists) return 'partial';
  return 'not_installed';
}
