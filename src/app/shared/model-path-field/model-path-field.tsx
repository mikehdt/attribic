'use client';

import { FolderOpenIcon, RotateCcwIcon, WrenchIcon } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { resolveInstalledPath } from '@/app/services/training/model-configured';
import { Button } from '@/app/shared/button';
import { Input } from '@/app/shared/input/input';
import { InputTray } from '@/app/shared/input-tray/input-tray';
import { ToolbarDivider } from '@/app/shared/toolbar-divider';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import { openModelManagerModal } from '@/app/store/model-manager';
import { selectAllModelStatuses } from '@/app/store/model-manager';

const MODEL_FILE_FILTER = 'safetensors,ckpt,bin,pt,pth';

type ModelPathFieldProps = {
  value: string;
  onChange: (path: string) => void;
  /** Human-readable component name used in browse dialog titles and tooltips (e.g. "T5-XXL Text Encoder"). */
  browseTitle: string;
  placeholder?: string;
  /** Registry ID of the downloadable model backing this component (if any). */
  downloadId?: string;
  /**
   * Explicit path the reset button should restore. Typically the last
   * saved default for this component. When omitted, the component falls
   * back to the system-downloaded path (if the download status is ready).
   */
  resetTo?: string;
  /**
   * When set, an unresolved downloadable component offers a "Set up…"
   * action that opens the Model Setup modal preselected on this model.
   * Leave unset inside the modal's own rows.
   */
  setupModelId?: string;
};

export function ModelPathField({
  value,
  onChange,
  browseTitle,
  placeholder,
  downloadId,
  resetTo,
  setupModelId,
}: ModelPathFieldProps) {
  const dispatch = useAppDispatch();
  const statuses = useAppSelector(selectAllModelStatuses);

  const downloadedPath = useMemo(
    () => resolveInstalledPath(downloadId, statuses),
    [downloadId, statuses],
  );

  const trimmedValue = value.trim();
  const trimmedResetTo = resetTo?.trim() ?? '';
  // Explicit resetTo wins; fall back to the system-downloaded path
  // so the button still works for downloadable models with no saved default.
  const resetTarget = trimmedResetTo !== '' ? trimmedResetTo : downloadedPath;
  const canReset =
    resetTarget !== null && resetTarget !== '' && trimmedValue !== resetTarget;
  const entry = downloadId ? statuses[downloadId] : undefined;
  const canOfferSetup =
    setupModelId !== undefined &&
    downloadId !== undefined &&
    downloadedPath === null &&
    trimmedValue === '' &&
    !canReset;
  const isDownloading = entry?.status === 'downloading';

  const handleBrowse = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        title: `Select ${browseTitle}`,
        filter: MODEL_FILE_FILTER,
      });
      const res = await fetch(`/api/filesystem/browse?${params}`);
      const data = await res.json();
      if (data.path) onChange(data.path);
    } catch {
      // Dialog failed — user can still type the path manually
    }
  }, [browseTitle, onChange]);

  const handleReset = useCallback(() => {
    if (resetTarget) onChange(resetTarget);
  }, [resetTarget, onChange]);

  // Hand acquisition off to Model Setup rather than downloading inline —
  // gives the user variant/precision choice, progress visibility, and a
  // single canonical place to reason about downloads and defaults.
  const handleOpenSetup = useCallback(() => {
    dispatch(openModelManagerModal({ tab: 'training', modelId: setupModelId }));
  }, [dispatch, setupModelId]);

  const hasExtra = canReset || (canOfferSetup && !isDownloading);

  return (
    <InputTray size="md" width="full" tone="deep">
      <Input
        type="text"
        size="md"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? `Path to ${browseTitle.toLowerCase()}...`}
        className="min-w-0 flex-1"
      />
      <Button
        onClick={handleBrowse}
        variant="ghost"
        size="md"
        width="md"
        title="Browse…"
      >
        <FolderOpenIcon />
      </Button>

      {hasExtra && (
        <div className="mx-1">
          <ToolbarDivider />
        </div>
      )}

      {canReset && (
        <Button
          onClick={handleReset}
          variant="ghost"
          size="md"
          width="md"
          color="indigo"
          title={`Reset to default (${resetTarget})`}
        >
          <RotateCcwIcon />
        </Button>
      )}

      {canOfferSetup && !isDownloading && (
        <Button
          onClick={handleOpenSetup}
          variant="ghost"
          size="md"
          color="indigo"
          title={`Download or configure ${browseTitle} in Model Setup`}
        >
          <WrenchIcon />
          Set up…
        </Button>
      )}
    </InputTray>
  );
}
