import {
  FolderIcon,
  FolderOpenIcon,
  FolderXIcon,
  PlusIcon,
  RefreshCwIcon,
  XIcon,
} from 'lucide-react';
import Image from 'next/image';
import { memo, useCallback, useMemo, useState } from 'react';

import type { TrainingFieldName } from '@/app/services/training/field-registry';
import type { TrainingProvider } from '@/app/services/training/types';
import { Button } from '@/app/shared/button';
import { CollapsibleSection } from '@/app/shared/collapsible-section';
import type { DatasetIssue } from '@/app/store/training-config';
import { projectThumbnailSrc } from '@/app/utils/project-thumbnail';

import { ProjectPicker } from '../../project-picker/project-picker';
import type {
  DatasetFolder,
  DatasetSource,
  ExtraFolder,
  FolderAugmentation,
  SectionName,
} from '../../training-config-form/use-training-config-form';
import { SectionHeaderExtra } from '../section-header-extra';
import { SectionResetButton } from '../section-reset-button';
import { FolderRow } from './folder-row';

type DatasetSectionProps = {
  datasets: DatasetSource[];
  /** Datasets whose folder no longer holds the images the config expects. */
  datasetIssues: DatasetIssue[];
  extraFolders: ExtraFolder[];
  selectedProvider: TrainingProvider;
  hasChanges: boolean;
  visibleFields: Set<TrainingFieldName>;
  hiddenChangesCount?: number;
  onAddDataset: (
    folderName: string,
    displayName: string,
    folders: Omit<DatasetFolder, keyof FolderAugmentation>[],
    thumbnail?: boolean,
    thumbnailVersion?: number,
    dimensionHistogram?: Record<string, number>,
  ) => void;
  onRemoveDataset: (index: number) => void;
  /** Re-read every attached dataset from disk: image dimensions and presence. */
  onRescanDatasets: () => void;
  onSetFolderRepeats: (
    datasetIndex: number | null,
    folderName: string,
    repeats: number | null,
  ) => void;
  onUpdateFolderAugment: (
    datasetIndex: number | null,
    folderName: string,
    updates: Partial<FolderAugmentation>,
  ) => void;
  onAddExtraFolder: (path: string) => void;
  onRemoveExtraFolder: (index: number) => void;
  onReset: (section: SectionName) => void;
};

const DatasetSectionComponent = ({
  datasets,
  datasetIssues,
  extraFolders,
  selectedProvider,
  hasChanges,
  visibleFields,
  hiddenChangesCount,
  onAddDataset,
  onRemoveDataset,
  onRescanDatasets,
  onSetFolderRepeats,
  onUpdateFolderAugment,
  onAddExtraFolder,
  onRemoveExtraFolder,
  onReset,
}: DatasetSectionProps) => {
  const excludeFolders = useMemo(
    () => datasets.map((ds) => ds.folderName),
    [datasets],
  );

  const issuesByFolder = useMemo(
    () => new Map(datasetIssues.map((issue) => [issue.folderName, issue])),
    [datasetIssues],
  );

  // Total folder count across projects + extras — drives whether the
  // repeats column is worth showing. A single folder has nothing to weight
  // against, so repeats is just a gussied-up "train N× as many steps".
  const totalFolderCount = useMemo(
    () =>
      datasets.reduce((sum, ds) => sum + ds.folders.length, 0) +
      extraFolders.length,
    [datasets, extraFolders],
  );
  const showRepeats = totalFolderCount > 1;

  // Track which folders have their augmentation panel expanded.
  // Keyed by "datasetIndex|folderName" (datasetIndex=-1 for extras).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleBrowseFolder = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        title: 'Select image folder',
        mode: 'folder',
      });
      const res = await fetch(`/api/filesystem/browse?${params}`);
      const data = await res.json();
      if (data.path) {
        onAddExtraFolder(data.path);
      }
    } catch {
      // Dialog failed — ignore
    }
  }, [onAddExtraFolder]);

  return (
    <CollapsibleSection
      title="Dataset"
      headerExtra={
        <SectionHeaderExtra
          hasChanges={hasChanges}
          hiddenChangesCount={hiddenChangesCount}
        />
      }
      headerActions={(expanded) =>
        expanded ? (
          <div className="flex items-center gap-1">
            {/* Dataset folders are read from disk when a dataset is picked, so
                editing the files afterwards leaves the warnings stale. */}
            {datasets.length > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRescanDatasets();
                }}
                title="Re-read dataset folders from disk"
                aria-label="Rescan dataset folders"
                className="cursor-pointer rounded p-1 text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-300"
              >
                <RefreshCwIcon className="h-4 w-4" />
              </button>
            )}
            {hasChanges && (
              <SectionResetButton onClick={() => onReset('dataset')} />
            )}
          </div>
        ) : undefined
      }
    >
      <div className="space-y-3">
        {datasets.length === 0 && extraFolders.length === 0 ? (
          <div className="rounded border border-dashed border-slate-300 px-4 py-6 text-center dark:border-slate-600">
            <p className="text-sm text-slate-400">
              No dataset sources added yet
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Add a tagging project
              {visibleFields.has('extraFolders') && ' or folder of images'} to
              begin
            </p>
            <div className="mt-3 flex items-center justify-center gap-2">
              <ProjectPicker
                onSelect={onAddDataset}
                excludeFolders={excludeFolders}
              >
                <PlusIcon />
                Add Project
              </ProjectPicker>

              {visibleFields.has('extraFolders') && (
                <Button
                  variant="ghost"
                  size="md"
                  width="lg"
                  onClick={handleBrowseFolder}
                >
                  <FolderOpenIcon />
                  Add Folder
                </Button>
              )}
            </div>
          </div>
        ) : (
          <>
            {datasets.map((ds, dsIndex) => {
              const issue = issuesByFolder.get(ds.folderName);
              return (
                <div
                  key={ds.folderName}
                  className={`rounded-md border bg-white p-3 dark:bg-slate-800 ${
                    issue ? 'border-amber-500/50' : 'border-(--surface-hover)'
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {ds.thumbnail ? (
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 dark:bg-slate-600">
                          <Image
                            src={projectThumbnailSrc(
                              ds.folderName,
                              ds.thumbnailVersion,
                            )}
                            alt={ds.projectName}
                            width={24}
                            height={24}
                            className="h-full w-full object-cover"
                          />
                        </span>
                      ) : (
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-600">
                          <FolderIcon className="h-3.5 w-3.5 text-slate-400" />
                        </span>
                      )}
                      <span className="text-sm font-medium text-(--foreground)">
                        {ds.projectName}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveDataset(dsIndex)}
                      className="cursor-pointer rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
                      title="Remove dataset source"
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* The folder rows below still show the counts the config was
                    saved with — say so, or they read as a live reading. */}
                  {issue && (
                    <div className="mb-2 flex items-start gap-1.5 rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1.5">
                      <FolderXIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                      <p className="text-sm text-(--foreground)/70">
                        {issue.reason === 'missing'
                          ? 'This folder is missing from the projects folder.'
                          : 'This folder no longer contains any images.'}{' '}
                        <span className="text-slate-400">
                          The counts below are what the saved config expects,
                          not what’s on disk — training is blocked until the
                          images are back (then rescan) or the dataset is
                          removed.
                        </span>
                      </p>
                    </div>
                  )}

                  <div className="divide-y divide-slate-300 dark:divide-slate-700">
                    {ds.folders.map((folder) => (
                      <FolderRow
                        key={folder.name}
                        datasetIndex={dsIndex}
                        selectedProvider={selectedProvider}
                        folderName={folder.name}
                        detectedRepeats={folder.detectedRepeats}
                        effectiveRepeats={
                          folder.overrideRepeats ?? folder.detectedRepeats
                        }
                        imageCount={folder.imageCount}
                        augmentation={folder}
                        showRepeats={showRepeats}
                        isExpanded={expanded.has(`${dsIndex}|${folder.name}`)}
                        onToggleExpanded={() =>
                          toggleExpanded(`${dsIndex}|${folder.name}`)
                        }
                        onSetRepeats={onSetFolderRepeats}
                        onUpdateAugment={onUpdateFolderAugment}
                        displayName={
                          folder.name === 'Root' ? ds.folderName : undefined
                        }
                      />
                    ))}
                  </div>
                </div>
              );
            })}

            <div className="flex gap-2">
              <ProjectPicker
                onSelect={onAddDataset}
                excludeFolders={excludeFolders}
                buttonSize="sm"
                buttonVariant="ghost"
              >
                <PlusIcon />
                Add Project
              </ProjectPicker>

              {visibleFields.has('extraFolders') && (
                <Button
                  onClick={handleBrowseFolder}
                  variant="ghost"
                  size="sm"
                  width="md"
                >
                  <FolderOpenIcon />
                  Add Folder
                </Button>
              )}
            </div>
          </>
        )}

        {/* Extra folders (intermediate+) — rendered with same per-folder
            treatment as dataset folders. */}
        {extraFolders.length > 0 && (
          <div className="rounded border border-(--border-subtle) bg-(--surface)/30 p-3">
            <div className="mb-2 flex items-center gap-2">
              <FolderIcon className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-sm font-medium text-(--foreground)">
                Extra Folders
              </span>
            </div>
            <div className="divide-y divide-slate-300 dark:divide-slate-700">
              {extraFolders.map((ef, i) => (
                <FolderRow
                  key={ef.path}
                  datasetIndex={null}
                  selectedProvider={selectedProvider}
                  folderName={ef.path}
                  detectedRepeats={1}
                  effectiveRepeats={ef.overrideRepeats ?? 1}
                  imageCount={ef.imageCount}
                  augmentation={ef}
                  showRepeats={showRepeats}
                  isExpanded={expanded.has(`extra|${ef.path}`)}
                  onToggleExpanded={() => toggleExpanded(`extra|${ef.path}`)}
                  onSetRepeats={onSetFolderRepeats}
                  onUpdateAugment={onUpdateFolderAugment}
                  onRemove={() => onRemoveExtraFolder(i)}
                  displayName={ef.path.split(/[\\/]/).pop() ?? ef.path}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
};

export const DatasetSection = memo(DatasetSectionComponent);
