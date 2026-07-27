'use client';

import type { ReactNode } from 'react';

import { NumberInput } from '@/app/shared/number-input/number-input';

type FolderNameFieldsProps = {
  /** Prefixes the generated input ids so two instances can coexist. */
  idPrefix: string;
  /** Caption for the text field — "Name" when creating, "Rename" when editing. */
  labelText: string;
  repeatCount: number;
  onRepeatCountChange: (value: number) => void;
  isRepeatCountValid: boolean;
  label: string;
  onLabelChange: (value: string) => void;
  isLabelValid: boolean;
  /** Resolved `{repeats}_{label}` folder name, shown as a preview. */
  folderName: string;
  /** Appended to the preview line, e.g. a collision warning. */
  note?: ReactNode;
  autoFocus?: boolean;
};

/**
 * The "Repeats × Name" pair used both for creating a new destination folder and
 * for renaming the folder the assets already live in.
 */
export const FolderNameFields = ({
  idPrefix,
  labelText,
  repeatCount,
  onRepeatCountChange,
  isRepeatCountValid,
  label,
  onLabelChange,
  isLabelValid,
  folderName,
  note,
  autoFocus,
}: FolderNameFieldsProps) => {
  const trimmedLabel = label.trim();

  return (
    <div className="flex w-full flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-600 dark:bg-slate-800">
      <div className="flex items-center gap-2">
        <div className="flex flex-col gap-1">
          <label
            htmlFor={`${idPrefix}-repeat-count`}
            className="text-xs text-slate-500"
          >
            Repeats
          </label>
          <NumberInput
            id={`${idPrefix}-repeat-count`}
            spinner
            kind="int"
            min={1}
            value={repeatCount}
            onChange={onRepeatCountChange}
            size="sm"
            className={`w-16 ${isRepeatCountValid ? '' : '!border-rose-400'}`}
          />
        </div>

        <span className="cursor-default self-end pb-1.5 text-sm text-slate-500">
          &times;
        </span>

        <div className="flex flex-1 flex-col gap-1">
          <label
            htmlFor={`${idPrefix}-label`}
            className="text-xs text-slate-500"
          >
            {labelText}
          </label>
          <input
            id={`${idPrefix}-label`}
            type="text"
            value={label}
            onChange={(e) => onLabelChange(e.target.value)}
            placeholder="e.g. sonic"
            autoFocus={autoFocus}
            className={`w-full rounded border px-2 py-1 text-sm ${
              trimmedLabel === '' || isLabelValid
                ? 'border-slate-300 dark:border-slate-600'
                : 'border-rose-400'
            } bg-white dark:bg-slate-700 dark:text-slate-200`}
          />
        </div>
      </div>

      {/* Preview */}
      {trimmedLabel && (
        <p className="text-xs text-slate-500">
          Folder name:{' '}
          <span className="font-mono font-medium text-slate-700 dark:text-slate-300">
            {folderName}
          </span>
          {note}
        </p>
      )}

      {/* Validation errors */}
      {trimmedLabel && !isLabelValid && (
        <p className="text-xs text-rose-600">
          Name may only contain letters, numbers, and hyphens.
        </p>
      )}
    </div>
  );
};
