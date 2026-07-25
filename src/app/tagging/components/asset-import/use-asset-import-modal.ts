'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useToast } from '@/app/shared/toast';
import { loadAllAssets, selectAllImages } from '@/app/store/assets';
import { selectAllSubfolders } from '@/app/store/assets/selectors';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import { selectProjectFolderName } from '@/app/store/project';
import {
  type ImportPlan,
  normaliseImportPath,
  planImport,
  type PlannedImport,
  splitSidecarName,
} from '@/app/utils/asset-import';

import type { DroppedFile } from './read-dropped-files';

/**
 * Uploads go up in batches: `formData()` buffers a whole request server-side, so
 * a 300-file drop in one POST would sit in memory all at once. Whichever limit
 * is hit first closes the batch.
 */
const BATCH_FILE_LIMIT = 12;
const BATCH_BYTE_LIMIT = 48 * 1024 * 1024;

type ServerSkip = { path: string; reason: string };

type ImportResponse = {
  written?: string[];
  skipped?: ServerSkip[];
  errors?: string[];
};

/** Split the plan into upload batches, keeping each asset with its sidecars. */
const batchAssets = (assets: PlannedImport[]): PlannedImport[][] => {
  const batches: PlannedImport[][] = [];
  let batch: PlannedImport[] = [];
  let bytes = 0;

  for (const asset of assets) {
    if (
      batch.length &&
      (batch.length >= BATCH_FILE_LIMIT ||
        bytes + asset.size > BATCH_BYTE_LIMIT)
    ) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(asset);
    bytes += asset.size;
  }

  if (batch.length) batches.push(batch);
  return batches;
};

const isSidecarPath = (targetPath: string): boolean =>
  splitSidecarName(targetPath.slice(targetPath.lastIndexOf('/') + 1)) !== null;

type UseAssetImportModalArgs = {
  isOpen: boolean;
  onClose: () => void;
  candidates: DroppedFile[];
};

export const useAssetImportModal = ({
  isOpen,
  onClose,
  candidates,
}: UseAssetImportModalArgs) => {
  const dispatch = useAppDispatch();
  const { showToast, showErrorToast } = useToast();

  const images = useAppSelector(selectAllImages);
  const subfolders = useAppSelector(selectAllSubfolders);
  const projectFolderName = useAppSelector(selectProjectFolderName);

  const [destination, setDestination] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional reset when the importer opens
    setDestination(null);
    setIsImporting(false);
    setProgress(0);
    setError(null);
  }, [isOpen]);

  const existingFileIds = useMemo(
    () => images.map((image) => image.fileId),
    [images],
  );

  const subfolderOptions = useMemo(
    () => Object.keys(subfolders).sort((a, b) => a.localeCompare(b)),
    [subfolders],
  );

  const plan: ImportPlan = useMemo(
    () =>
      planImport({
        candidates: candidates.map((candidate) => ({
          relativePath: candidate.relativePath,
          size: candidate.file.size,
        })),
        existingFileIds,
        destination,
      }),
    [candidates, existingFileIds, destination],
  );

  /** Files grouped by where they land, so the summary can show the split. */
  const groups = useMemo(() => {
    const counts = new Map<string, { count: number; detected: boolean }>();
    for (const asset of plan.assets) {
      const key = asset.subfolder ?? '';
      const current = counts.get(key);
      if (current) {
        current.count += 1;
      } else {
        counts.set(key, { count: 1, detected: asset.detected });
      }
    }
    return Array.from(counts.entries())
      .map(([subfolder, value]) => ({ subfolder, ...value }))
      .sort((a, b) => a.subfolder.localeCompare(b.subfolder));
  }, [plan.assets]);

  /** The destination picker is noise when there's nowhere else to put things. */
  const showDestination =
    subfolderOptions.length > 0 && plan.assets.some((asset) => !asset.detected);

  const handleImport = useCallback(async () => {
    if (!projectFolderName || !plan.assets.length) return;

    const fileByPath = new Map(
      candidates.map((candidate) => [
        normaliseImportPath(candidate.relativePath),
        candidate.file,
      ]),
    );

    setIsImporting(true);
    setProgress(0);
    setError(null);

    let importedAssets = 0;
    let skippedByServer = 0;
    let failed = 0;
    let done = 0;

    for (const batch of batchAssets(plan.assets)) {
      const formData = new FormData();
      formData.append('project', projectFolderName);

      for (const asset of batch) {
        const file = fileByPath.get(asset.relativePath);
        if (file) {
          formData.append('path', asset.targetPath);
          formData.append('file', file);
        }
        for (const sidecar of asset.sidecars) {
          const sidecarFile = fileByPath.get(sidecar.relativePath);
          if (sidecarFile) {
            formData.append('path', sidecar.targetPath);
            formData.append('file', sidecarFile);
          }
        }
      }

      try {
        const response = await fetch('/api/assets/import', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || `Import failed (${response.status})`);
        }

        const result: ImportResponse = await response.json();
        importedAssets += (result.written ?? []).filter(
          (target) => !isSidecarPath(target),
        ).length;
        skippedByServer += (result.skipped ?? []).filter(
          (skip) => skip.reason !== 'orphaned',
        ).length;
        failed += (result.errors ?? []).length;
      } catch (uploadError) {
        console.error('Asset import failed:', uploadError);
        setError(
          uploadError instanceof Error
            ? uploadError.message
            : 'Import failed. Check the dev server console.',
        );
        setIsImporting(false);
        // Whatever landed before the failure is on disk, so still refresh.
        if (importedAssets > 0) {
          dispatch(
            loadAllAssets({
              maintainIoState: false,
              projectPath: projectFolderName,
            }),
          );
        }
        return;
      }

      done += batch.length;
      setProgress(done);
    }

    dispatch(
      loadAllAssets({
        maintainIoState: false,
        projectPath: projectFolderName,
      }),
    );

    const totalSkipped = plan.skipped.length + skippedByServer;
    const summary = [
      `Imported ${importedAssets} file${importedAssets === 1 ? '' : 's'}`,
      totalSkipped ? `${totalSkipped} skipped` : null,
      failed ? `${failed} failed` : null,
    ]
      .filter(Boolean)
      .join(' — ');

    if (failed) {
      showErrorToast(summary);
    } else {
      showToast(summary);
    }

    setIsImporting(false);
    onClose();
  }, [
    candidates,
    dispatch,
    onClose,
    plan.assets,
    plan.skipped.length,
    projectFolderName,
    showErrorToast,
    showToast,
  ]);

  return {
    plan,
    groups,
    destination,
    setDestination,
    subfolderOptions,
    showDestination,
    isImporting,
    progress,
    error,
    handleImport,
  };
};
