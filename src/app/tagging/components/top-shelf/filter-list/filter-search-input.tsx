import { XIcon } from 'lucide-react';
import type { KeyboardEvent, RefObject } from 'react';

/**
 * The filter panel's search row — input plus clear button. Shared by the Tags,
 * Sizes and Buckets views, which had three copies of this markup that had
 * already drifted apart in their dark-mode placeholder classes.
 *
 * The File view keeps its own: its input adds filename patterns rather than
 * filtering the list below it, and carries an add button instead of a clear one.
 */

type FilterSearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  /** Noun for the placeholder and the accessible name, e.g. "tags". */
  subject: string;
};

export const FilterSearchInput = ({
  value,
  onChange,
  onKeyDown,
  inputRef,
  subject,
}: FilterSearchInputProps) => {
  const hasText = value.trim() !== '';

  return (
    <div className="relative shrink-0 border-b border-slate-200 bg-slate-50 px-2 py-2 dark:border-slate-700 dark:bg-slate-800">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
        placeholder={`Search ${subject}...`}
        aria-label={`Search ${subject}`}
        className="w-full rounded-full border border-slate-300 bg-white py-1 ps-4 pe-8 placeholder-slate-400 inset-shadow-sm inset-shadow-slate-200 transition-all dark:border-slate-600 dark:bg-slate-700 dark:placeholder-slate-400 dark:inset-shadow-slate-800"
      />
      <button
        className={`absolute top-3 right-4 h-5 w-5 rounded-full p-0.5 transition-colors ${
          hasText
            ? 'cursor-pointer text-slate-600 hover:bg-slate-500 hover:text-white dark:text-slate-400 dark:hover:bg-slate-600'
            : 'pointer-events-none text-white dark:text-slate-700'
        }`}
        onClick={hasText ? () => onChange('') : undefined}
        aria-label="Clear search"
      >
        <XIcon className="h-4 w-4" />
      </button>
    </div>
  );
};
