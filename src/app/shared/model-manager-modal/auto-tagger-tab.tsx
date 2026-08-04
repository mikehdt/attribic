'use client';

import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import type { AppDispatch } from '@/app/store';
import {
  fetchAutoTaggerModels,
  selectModels,
  selectModelsError,
  selectProviders,
} from '@/app/store/auto-tagger';
import type { ModelInfo } from '@/app/store/auto-tagger/types';
import { useAppSelector } from '@/app/store/hooks';
import { selectDownloadJobByModelId } from '@/app/store/jobs';

import { formatBytes } from '../activity-panel/helpers';
import { useDownloadActions } from '../activity-panel/use-download-actions';
import { DeleteInstalledButton } from './delete-installed-button';
import { DownloadRowButton, DownloadRowStatus } from './download-row-status';

// ---------------------------------------------------------------------------
// Auto-Tagger tab
// ---------------------------------------------------------------------------

export function AutoTaggerTab() {
  const dispatch = useDispatch<AppDispatch>();
  const providers = useSelector(selectProviders);
  const models = useSelector(selectModels);
  const error = useSelector(selectModelsError);

  useEffect(() => {
    dispatch(fetchAutoTaggerModels());
  }, [dispatch]);

  return (
    <div className="flex flex-col gap-4 px-1">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Models for automatic image tagging and captioning.
      </p>

      {providers.map((provider) => {
        const providerModels = models.filter((m) => m.provider === provider.id);
        if (providerModels.length === 0) return null;
        return (
          <div key={provider.id}>
            <div className="mb-2">
              <h3 className="border-b border-slate-200 px-1 pb-1 text-xs font-medium tracking-wide text-slate-400 uppercase dark:border-slate-700">
                {provider.name}
              </h3>
              <p className="mt-1 px-1 text-sm text-slate-500">
                {provider.description}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {providerModels.map((model) => (
                <AutoTaggerModelRow key={model.id} model={model} />
              ))}
            </div>
          </div>
        );
      })}
      {error && (
        <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-model row (extracted so each row can subscribe to its own job state)
// ---------------------------------------------------------------------------

function AutoTaggerModelRow({ model }: { model: ModelInfo }) {
  const job = useAppSelector((state) =>
    selectDownloadJobByModelId(state, model.id),
  );
  const { start, retry, cancel, remove, uninstall } = useDownloadActions();

  const isReady = model.status === 'ready';
  const isPartial = model.status === 'partial';

  // A job is "live" if it's currently running, interrupted, failed, or cancelled —
  // i.e. anything except completed (which means the model is now installed).
  const hasLiveJob = job && job.status !== 'completed';
  // Server reports 'downloading' when another tab in the same Node process
  // is actively writing this model — suppress local actions to avoid
  // clobbering the live write.
  const isDownloadingElsewhere = model.status === 'downloading' && !hasLiveJob;

  const handleDownload = () => {
    start({ id: model.id, name: model.name });
  };

  const handleUninstall = () => {
    uninstall(model.id);
  };

  return (
    <div
      className={`rounded-md border bg-white p-3 transition-colors dark:bg-slate-800 ${
        isReady
          ? 'border-teal-200 dark:border-teal-800'
          : 'border-slate-200 dark:border-slate-700'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-800 dark:text-slate-200">
              {model.name}
            </span>
            {model.isDefault && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                Recommended
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
          </div>
          {model.description && (
            <p className="mt-1 text-sm text-slate-500">{model.description}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!hasLiveJob && (
            <span className="text-right text-xs text-slate-400 tabular-nums">
              {formatBytes(model.totalSize)}
              {model.memoryEstimate && (
                <span className="block text-slate-400/70">
                  ~{model.memoryEstimate}GB{' '}
                  {model.runtime === 'transformers' ? 'VRAM' : 'RAM'}
                </span>
              )}
            </span>
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
              sizeBytes={model.totalSize}
              onConfirm={handleUninstall}
            />
          ) : isPartial ? (
            <div className="flex items-center gap-2">
              <DownloadRowButton onClick={handleDownload} label="Resume" />
              <DeleteInstalledButton
                sizeBytes={model.totalSize}
                onConfirm={handleUninstall}
              />
            </div>
          ) : (
            <DownloadRowButton onClick={handleDownload} label="Download" />
          )}
        </div>
      </div>
    </div>
  );
}
