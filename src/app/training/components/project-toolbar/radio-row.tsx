import type { ReactNode } from 'react';

type RadioRowProps = {
  name: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  /** `start` nudges the radio down to sit level with a leading 32px thumbnail. */
  align?: 'center' | 'start';
  onChange: () => void;
  children: ReactNode;
};

/**
 * Radio-row styled to match the move-to-folder modal: custom-styled radio
 * indicator, hover/selected background, free-form content on the right.
 */
export const RadioRow = ({
  name,
  value,
  checked,
  disabled,
  align = 'center',
  onChange,
  children,
}: RadioRowProps) => {
  const isStart = align === 'start';
  return (
    <label
      className={`flex cursor-pointer gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
        isStart ? 'items-start' : 'items-center'
      } ${
        disabled
          ? 'cursor-not-allowed opacity-40'
          : checked
            ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200'
            : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700/50'
      }`}
    >
      <div
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-all ${
          isStart ? 'mt-2' : ''
        } ${
          disabled
            ? 'border-slate-300 bg-slate-50'
            : checked
              ? 'border-sky-700 bg-linear-to-t from-sky-600 to-sky-500 inset-shadow-xs inset-shadow-sky-300'
              : 'border-slate-400 bg-linear-to-t from-slate-100 to-white inset-shadow-xs inset-shadow-slate-300'
        }`}
      >
        {checked && (
          <div className="h-1.5 w-1.5 rounded-full bg-white shadow-sm shadow-sky-800" />
        )}
      </div>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="sr-only"
      />
      <div
        className={`flex min-w-0 flex-1 gap-2 ${isStart ? 'items-start' : 'items-center'}`}
      >
        {children}
      </div>
    </label>
  );
};
