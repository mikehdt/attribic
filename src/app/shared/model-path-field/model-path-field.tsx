'use client';

import {
  CheckIcon,
  FolderOpenIcon,
  RotateCcwIcon,
  WrenchIcon,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

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
   * The saved default for this component, if the surface has one. Takes
   * precedence over the installed download as the path this field falls back
   * to when the user hasn't overridden anything.
   */
  savedDefaultPath?: string;
  /**
   * What "stop overriding" means here. `fill` writes the fallback path back
   * into the field (the training form, whose values are submitted verbatim);
   * `clear` empties it (the model defaults editor, where empty already means
   * "use the downloaded model").
   */
  revertMode?: 'fill' | 'clear';
  /**
   * When set, an unresolved downloadable component offers a "Set up…"
   * action that opens the Model Setup modal preselected on this model.
   * Leave unset inside the modal's own rows.
   */
  setupModelId?: string;
};

/** Last path segment — the bit that identifies a file at a glance. */
function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/**
 * Path picker for one model component.
 *
 * A component that already resolves on its own — a downloaded model, or a
 * saved default — renders as a one-line "it's set" readout rather than a text
 * box repeating a path the user never typed. The box is for *overrides*: files
 * that differ from what the app resolves by itself.
 */
export function ModelPathField({
  value,
  onChange,
  browseTitle,
  placeholder,
  downloadId,
  savedDefaultPath,
  revertMode = 'fill',
  setupModelId,
}: ModelPathFieldProps) {
  const dispatch = useAppDispatch();
  const statuses = useAppSelector(selectAllModelStatuses);
  const [isOverriding, setIsOverriding] = useState(false);

  const downloadedPath = useMemo(
    () => resolveInstalledPath(downloadId, statuses),
    [downloadId, statuses],
  );

  const trimmedValue = value.trim();
  const savedDefault = savedDefaultPath?.trim() ?? '';
  // What this component resolves to with no override in play. An explicit
  // saved default beats the download it may or may not have come from.
  const fallbackPath =
    savedDefault !== '' ? savedDefault : (downloadedPath ?? '');
  const usesDownload = savedDefault === '';
  const fallbackLabel = usesDownload
    ? 'Using downloaded model'
    : 'Using saved model file';
  const hasFallback = fallbackPath !== '';
  const isOverridden =
    hasFallback && trimmedValue !== '' && trimmedValue !== fallbackPath;

  // Override mode is per component, and these fields are keyed by component
  // type — switching model reuses the instance, so a field left in override
  // mode would greet the next model with an open text box.
  const [syncedFallback, setSyncedFallback] = useState(fallbackPath);
  if (fallbackPath !== syncedFallback) {
    setSyncedFallback(fallbackPath);
    setIsOverriding(false);
  }

  const entry = downloadId ? statuses[downloadId] : undefined;
  const isDownloading = entry?.status === 'downloading';
  const canOfferSetup =
    setupModelId !== undefined &&
    downloadId !== undefined &&
    !hasFallback &&
    trimmedValue === '';

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

  const handleRevert = useCallback(() => {
    onChange(revertMode === 'clear' ? '' : fallbackPath);
    setIsOverriding(false);
  }, [onChange, revertMode, fallbackPath]);

  // Hand acquisition off to Model Setup rather than downloading inline —
  // gives the user variant/precision choice, progress visibility, and a
  // single canonical place to reason about downloads and defaults.
  const handleOpenSetup = useCallback(() => {
    dispatch(openModelManagerModal({ tab: 'training', modelId: setupModelId }));
  }, [dispatch, setupModelId]);

  // Resolved and untouched: say so, and offer the override rather than
  // pre-filling a path the user would only have to recognise and ignore.
  if (hasFallback && !isOverridden && !isOverriding) {
    return (
      <InputTray size="md" tone="deep">
        <div className="flex w-full items-center gap-2 rounded-sm border border-slate-300 bg-white py-1.5 pl-2 dark:border-slate-700 dark:bg-slate-800">
          <CheckIcon className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
          <span className="shrink-0 text-sm text-slate-500 dark:text-slate-400">
            {fallbackLabel}
          </span>
          <span
            className="min-w-0 flex-1 truncate text-sm font-medium"
            title={fallbackPath}
          >
            {basename(fallbackPath)}
          </span>
        </div>
        <Button
          onClick={() => setIsOverriding(true)}
          variant="ghost"
          size="md"
          color="indigo"
          title={`Use a different file for ${browseTitle}`}
        >
          Override…
        </Button>
      </InputTray>
    );
  }

  const canRevert = hasFallback;
  const hasExtra = canRevert || (canOfferSetup && !isDownloading);

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

      {canRevert && (
        <Button
          onClick={handleRevert}
          variant="ghost"
          size="md"
          width="md"
          color="indigo"
          title={`Go back to the ${
            usesDownload ? 'downloaded model' : 'saved model file'
          } (${fallbackPath})`}
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
