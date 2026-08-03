/**
 * Types for the model manager Redux slice.
 *
 * Tracks model inventory and installation status.
 * Active download operations are tracked in the jobs slice.
 */

import type { ModelStatus } from '@/app/services/model-manager/types';

export type ModelEntry = {
  modelId: string;
  status: ModelStatus;
  /** Resolved local path (null if not downloaded/located) */
  localPath: string | null;
  /**
   * Server-computed path to use in training component fields — derived from
   * the download manifest, so it reflects the variant actually installed.
   * Single-file models resolve to the file; bundles to the directory.
   */
  resolvedPath?: string | null;
  /** Total file size in bytes */
  sizeBytes: number;
};

export type ModelManagerState = {
  /** Known models and their on-disk status, keyed by model ID */
  models: Record<string, ModelEntry>;

  /** Resolved models folder path (from config.json or default) */
  modelsFolder: string | null;

  /** True while we're scanning disk for installed models */
  isScanning: boolean;

  /**
   * True once the first status fetch has completed — consumers that filter
   * on installed-ness (e.g. the training model dropdown) should treat the
   * state as unknown until then rather than as "nothing installed".
   */
  hasLoadedStatuses: boolean;

  /** Whether the model manager modal is open */
  isModalOpen: boolean;

  /** Which tab to show when the modal opens */
  modalInitialTab?: 'auto-tagger' | 'training' | 'settings';

  /** Which model the training tab should preselect when the modal opens */
  modalInitialModelId?: string;
};
