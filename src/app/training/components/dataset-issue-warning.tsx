import { FolderXIcon } from 'lucide-react';
import { memo } from 'react';

import type { DatasetIssue } from '@/app/store/training-config';

type DatasetIssueWarningProps = {
  issues: DatasetIssue[];
};

/**
 * Shown in place of the bucket / native-resolution panel when a dataset the
 * config claims images for has nothing behind it on disk.
 *
 * Without this the failure is close to invisible: with no image sizes to
 * assign, the bucket preview quietly falls back to listing every bucket the
 * resolution allows, which reads like a healthy dataset. The run itself then
 * fails minutes later inside the sidecar.
 */
const DatasetIssueWarningComponent = ({ issues }: DatasetIssueWarningProps) => (
  <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
    <div className="mb-2 flex items-center gap-1.5">
      <FolderXIcon className="h-4 w-4 shrink-0 text-amber-500" />
      <span className="text-sm font-medium text-amber-500">
        {issues.length === 1 ? 'Dataset not found' : 'Datasets not found'}
      </span>
    </div>

    <ul className="space-y-1.5">
      {issues.map((issue) => (
        <li key={issue.folderName} className="text-sm text-(--foreground)/70">
          <span className="font-medium">{issue.projectName}</span>{' '}
          <span className="text-slate-400">
            {issue.reason === 'missing'
              ? 'folder is missing from the projects folder'
              : 'folder holds no images'}
            {' — '}
            <span className="break-all">{issue.folderName}</span>
          </span>
        </li>
      ))}
    </ul>

    <p className="mt-2 text-sm text-slate-400">
      Training is blocked until this is resolved. Put the images back and rescan
      from the Dataset section, or remove the dataset.
    </p>
  </div>
);

export const DatasetIssueWarning = memo(DatasetIssueWarningComponent);
