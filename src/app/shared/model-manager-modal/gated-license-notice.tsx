'use client';

import { ExternalLinkIcon, InfoIcon } from 'lucide-react';

import type { DownloadableModel } from '@/app/services/model-manager/types';

type GatedLicenseNoticeProps = {
  requiresLicense: NonNullable<DownloadableModel['requiresLicense']>;
  /** Show the extra "add your HF token" hint when no token is configured. */
  needsToken: boolean;
};

/** Amber panel explaining what a gated HuggingFace repo needs before download. */
export function GatedLicenseNotice({
  requiresLicense,
  needsToken,
}: GatedLicenseNoticeProps) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-amber-300 p-1.5 dark:border-amber-800">
      {needsToken && (
        <div className="flex gap-1.5">
          <InfoIcon className="h-3.5 w-3.5" />
          <p className="flex-1 text-xs">
            Add your HuggingFace token in Settings to download.
          </p>
        </div>
      )}

      <div className="flex gap-1.5">
        <InfoIcon className="h-3.5 w-3.5" />
        <p className="flex-1 text-xs">
          Requires accepting the {requiresLicense.name ?? 'repository'} license
          to download.{' '}
          <a
            href={requiresLicense.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 underline hover:text-amber-800 dark:hover:text-amber-300"
          >
            Accept on HuggingFace
            <ExternalLinkIcon className="h-3 w-3" />
          </a>
        </p>
      </div>
    </div>
  );
}
