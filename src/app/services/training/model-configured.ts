/**
 * Resolution logic for model components: given the user's saved default
 * paths and the model manager's installed-download statuses, work out which
 * components of a model actually have usable weights — and therefore which
 * models are "configured" enough to offer in the training form.
 */

import { getTrainingDownloadable } from '@/app/services/model-manager/registries/training-models';
import { resolveDownloadedPath } from '@/app/services/model-manager/resolve-downloaded-path';
import type { ModelStatus } from '@/app/services/model-manager/types';

import {
  getModelComponents,
  type ModelComponent,
  type ModelDefinition,
} from './models';
import type { ModelPaths } from './types';

/** Structural subset of the model-manager store's ModelEntry. */
export type ComponentStatusMap = Record<
  string,
  {
    status: ModelStatus;
    localPath: string | null;
    /** Server-computed path from the download manifest (variant-aware). */
    resolvedPath?: string | null;
  }
>;

export type ResolvedComponentPath = {
  path: string | null;
  source: 'default' | 'download' | null;
};

/**
 * The path a component resolves to, if any. A saved default (an explicit
 * user choice) wins over an installed download (an implicit fallback).
 */
export function resolveComponentPath(
  component: ModelComponent,
  savedPaths: ModelPaths | undefined,
  statuses: ComponentStatusMap,
): ResolvedComponentPath {
  const saved = savedPaths?.[component.type]?.trim();
  if (saved) return { path: saved, source: 'default' };

  const installed = resolveInstalledPath(component.downloadId, statuses);
  if (installed) return { path: installed, source: 'download' };

  return { path: null, source: null };
}

/**
 * Comparison key for a model path. Separators and case both vary between
 * what a browse dialog hands back, what the download engine writes, and what
 * a user typed — on Windows all three refer to the same file.
 */
export function normalizePathKey(path: string): string {
  return path
    .trim()
    .replace(/[\\/]+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase();
}

/** Path of a ready installed download, or null. */
export function resolveInstalledPath(
  downloadId: string | undefined,
  statuses: ComponentStatusMap,
): string | null {
  if (!downloadId) return null;
  const entry = statuses[downloadId];
  if (entry?.status !== 'ready') return null;
  // The server-computed path knows which variant's files actually exist.
  if (entry.resolvedPath) return entry.resolvedPath;
  if (!entry.localPath) return null;
  const downloadable = getTrainingDownloadable(downloadId);
  return downloadable
    ? resolveDownloadedPath(entry.localPath, downloadable)
    : null;
}

export type ModelReadiness = {
  /** Required components resolved, for the best available backend. */
  resolved: number;
  requiredTotal: number;
  configured: boolean;
};

/**
 * Readiness of a model for training, judged per backend: a model is
 * configured when *some* backend has every required component resolvable.
 * (The deduped all-components union would wrongly demand e.g. both Anima's
 * kohya file trio and its ai-toolkit diffusers directory at once.)
 * Reports the closest-to-ready backend's counts for partial-progress chips.
 */
export function getModelReadiness(
  model: ModelDefinition,
  savedPaths: ModelPaths | undefined,
  statuses: ComponentStatusMap,
): ModelReadiness {
  let best: ModelReadiness = {
    resolved: 0,
    requiredTotal: 0,
    configured: false,
  };
  let bestRatio = -1;

  for (const provider of model.providers) {
    if (provider === 'mock') continue;
    const required = getModelComponents(model, provider).filter(
      (c) => c.required,
    );
    const resolved = required.filter(
      (c) => resolveComponentPath(c, savedPaths, statuses).path !== null,
    ).length;
    const configured = required.length > 0 && resolved === required.length;
    const ratio = required.length === 0 ? 0 : resolved / required.length;
    if (configured)
      return { resolved, requiredTotal: required.length, configured };
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = { resolved, requiredTotal: required.length, configured };
    }
  }

  return best;
}

export function isModelConfigured(
  model: ModelDefinition,
  savedPaths: ModelPaths | undefined,
  statuses: ComponentStatusMap,
): boolean {
  return getModelReadiness(model, savedPaths, statuses).configured;
}
