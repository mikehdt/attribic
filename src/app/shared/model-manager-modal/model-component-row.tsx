'use client';

import { useCallback, useMemo, useState } from 'react';

import { getTrainingDownloadable } from '@/app/services/model-manager/registries/training-models';
import { resolveInstalledPath } from '@/app/services/training/model-configured';
import type { ModelComponent } from '@/app/services/training/models';
import { ModelPathField } from '@/app/shared/model-path-field/model-path-field';
import { useAppSelector } from '@/app/store/hooks';
import { selectDownloadJobByModelId } from '@/app/store/jobs';
import { selectAllModelStatuses } from '@/app/store/model-manager';

import { formatBytes } from '../activity-panel/helpers';
import { useDownloadActions } from '../activity-panel/use-download-actions';
import { Dropdown, type DropdownItem } from '../dropdown';
import { useHfTokenStatus } from '../use-hf-token-status';
import { DeleteInstalledButton } from './delete-installed-button';
import { DownloadRowButton, DownloadRowStatus } from './download-row-status';
import { GatedLicenseNotice } from './gated-license-notice';
import { getModelStatus } from './use-model-manager';

type ModelComponentRowProps = {
  component: ModelComponent;
  /** The draft default path for this component (may be empty). */
  value: string;
  onChange: (path: string) => void;
};

/**
 * One row per model component in the training setup tab: the saved default
 * path, the installed-download state, and download/delete actions — the
 * whole story of "where do this component's weights come from" in one place.
 */
export function ModelComponentRow({
  component,
  value,
  onChange,
}: ModelComponentRowProps) {
  const statuses = useAppSelector(selectAllModelStatuses);
  const downloadable = useMemo(
    () =>
      component.downloadId
        ? getTrainingDownloadable(component.downloadId)
        : undefined,
    [component.downloadId],
  );

  const [selectedVariantId, setSelectedVariantId] = useState<string>(
    downloadable?.variants?.[0]?.id ?? 'default',
  );

  const variantItems = useMemo<DropdownItem<string>[]>(
    () =>
      downloadable?.variants?.map((v) => {
        const size = v.files.reduce((sum, f) => sum + f.size, 0);
        return {
          value: v.id,
          label: `${v.label} (${formatBytes(size)})`,
        };
      }) ?? [],
    [downloadable?.variants],
  );

  const job = useAppSelector((state) =>
    component.downloadId
      ? selectDownloadJobByModelId(state, component.downloadId)
      : undefined,
  );
  const { start, retry, cancel, remove, uninstall } = useDownloadActions();
  const hasLiveJob = job && job.status !== 'completed';

  const hasHfToken = useHfTokenStatus();
  // Gate downloads of gated models until a token is set. Resume is also
  // blocked — without a token HF returns 401 on the very next range request
  // and the user's left with a stuck "Resume" that won't work.
  const needsToken = !!downloadable?.requiresLicense && hasHfToken === false;

  const status = downloadable
    ? getModelStatus(statuses, downloadable.id)
    : 'not_installed';
  const isReady = status === 'ready';
  const isPartial = status === 'partial';
  // Server reports 'downloading' when another tab in the same Node process
  // is actively writing this model — suppress local actions to avoid
  // clobbering the live write.
  const isDownloadingElsewhere = status === 'downloading' && !hasLiveJob;

  const installedPath = resolveInstalledPath(component.downloadId, statuses);

  const activeFiles =
    downloadable?.variants?.find((v) => v.id === selectedVariantId)?.files ??
    downloadable?.files ??
    [];
  const totalSize = activeFiles.reduce((sum, f) => sum + f.size, 0);

  const handleDownload = useCallback(() => {
    if (!downloadable) return;
    const variant = downloadable.variants?.find(
      (v) => v.id === selectedVariantId,
    );
    start(downloadable, variant);
  }, [start, downloadable, selectedVariantId]);

  const handleUninstall = useCallback(() => {
    if (downloadable) uninstall(downloadable.id);
  }, [uninstall, downloadable]);

  const hasPath = value.trim() !== '';

  return (
    <div
      className={`rounded-md border bg-white p-3 transition-colors dark:bg-slate-800 ${
        isReady || hasPath
          ? 'border-teal-200 dark:border-teal-800'
          : 'border-slate-200 dark:border-slate-700'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-800 dark:text-slate-200">
              {component.label}
            </span>
            {!component.required && (
              <span className="text-sm font-normal text-slate-400">
                (optional)
              </span>
            )}
            {downloadable?.sharedId && (
              <span
                className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-700 dark:text-slate-400"
                title="Shared component — downloaded once, used by every model that needs it"
              >
                Shared
              </span>
            )}
            {isReady && (
              <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs text-teal-700 dark:bg-teal-900 dark:text-teal-300">
                Installed
              </span>
            )}
            {isPartial && !hasLiveJob && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                Incomplete
              </span>
            )}
            {downloadable?.requiresLicense && !isReady && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                Gated
              </span>
            )}
          </div>

          {!downloadable && (
            <p className="mt-0.5 text-sm text-slate-500">
              Supply your own weights — no managed download available.
            </p>
          )}
        </div>

        {downloadable && (
          <div className="flex shrink-0 items-center gap-2">
            {!hasLiveJob && (
              <span className="text-right text-xs text-slate-400 tabular-nums">
                {formatBytes(totalSize)}
              </span>
            )}

            {/* Variant selector — only when no job is in flight */}
            {!hasLiveJob &&
              !isDownloadingElsewhere &&
              downloadable.variants &&
              downloadable.variants.length > 1 &&
              !isReady && (
                <Dropdown
                  items={variantItems}
                  selectedValue={selectedVariantId}
                  onChange={setSelectedVariantId}
                  selectedValueRenderer={(item) => (
                    <span className="text-sm">{item.value.toUpperCase()}</span>
                  )}
                  aria-label={`${downloadable.name} precision`}
                  size="sm"
                />
              )}

            {hasLiveJob ? (
              <DownloadRowStatus
                job={job}
                onRetry={retry}
                onCancel={cancel}
                onDelete={remove}
              />
            ) : isDownloadingElsewhere ? (
              <span
                className="rounded-full bg-sky-100 px-3 py-1 text-xs text-sky-700 dark:bg-sky-900/50 dark:text-sky-300"
                title="This model is being downloaded in another tab."
              >
                Downloading in another tab…
              </span>
            ) : isReady ? (
              <DeleteInstalledButton
                sizeBytes={totalSize}
                onConfirm={handleUninstall}
              />
            ) : isPartial ? (
              <div className="flex items-center gap-2">
                <DownloadRowButton
                  onClick={handleDownload}
                  label="Resume"
                  disabled={needsToken}
                  title={
                    needsToken
                      ? 'Add your HuggingFace token in Settings to resume'
                      : undefined
                  }
                />
                <DeleteInstalledButton
                  sizeBytes={totalSize}
                  onConfirm={handleUninstall}
                />
              </div>
            ) : (
              <DownloadRowButton
                onClick={handleDownload}
                label="Download"
                disabled={needsToken}
                title={
                  needsToken
                    ? 'Set a HuggingFace token in Settings to download'
                    : undefined
                }
              />
            )}
          </div>
        )}
      </div>

      <ModelPathField
        value={value}
        onChange={onChange}
        browseTitle={component.label}
        downloadId={component.downloadId}
        placeholder={
          installedPath && !hasPath
            ? `Using installed download — ${installedPath}`
            : undefined
        }
        className="mt-2 dark:bg-slate-900"
      />

      {component.hint && (
        <p className="mt-1 text-xs text-slate-400">{component.hint}</p>
      )}

      {downloadable?.requiresLicense && !isReady && (
        <GatedLicenseNotice
          requiresLicense={downloadable.requiresLicense}
          needsToken={needsToken}
        />
      )}
    </div>
  );
}
