'use client';

import type { ProjectColor } from './project-colors';

const swatches: {
  value: ProjectColor;
  label: string;
  class: string;
  activeClass: string;
}[] = [
  {
    value: 'slate',
    label: 'Grey',
    class:
      'border-slate-300 bg-slate-100 hover:border-slate-600 hover:bg-slate-500 dark:border-slate-700 dark:bg-slate-800',
    activeClass:
      'border-slate-800 bg-slate-500 shadow-slate-500 dark:border-slate-200 dark:shadow-slate-300',
  },
  {
    value: 'rose',
    label: 'Rose',
    class:
      'border-rose-300 bg-rose-100 hover:border-rose-600 hover:bg-rose-400 dark:border-rose-800 dark:bg-rose-900',
    activeClass:
      'border-rose-800 bg-rose-500 shadow-rose-500 dark:border-rose-200 dark:shadow-rose-300',
  },
  {
    value: 'amber',
    label: 'Amber',
    class:
      'border-amber-300 bg-amber-100 hover:border-amber-600 hover:bg-amber-500 dark:border-amber-800 dark:bg-amber-900',
    activeClass:
      'border-amber-800 bg-amber-500 shadow-amber-500 dark:border-amber-200 dark:shadow-amber-300',
  },
  {
    value: 'teal',
    label: 'Teal',
    class:
      'border-teal-300 bg-teal-100 hover:border-teal-600 hover:bg-teal-500 dark:border-teal-700 dark:bg-teal-800',
    activeClass:
      'border-teal-800 bg-teal-500 shadow-teal-500 dark:border-teal-200 dark:shadow-teal-300',
  },
  {
    value: 'sky',
    label: 'Sky',
    class:
      'border-sky-300 bg-sky-100 hover:border-sky-600 hover:bg-sky-500 dark:border-sky-700 dark:bg-sky-800',
    activeClass:
      'border-sky-800 bg-sky-500 shadow-sky-500 dark:border-sky-200 dark:shadow-sky-300',
  },
  {
    value: 'indigo',
    label: 'Indigo',
    class:
      'border-indigo-300 bg-indigo-100 hover:border-indigo-600 hover:bg-indigo-500 dark:border-indigo-600 dark:bg-indigo-700',
    activeClass:
      'border-indigo-800 bg-indigo-500 shadow-indigo-500 dark:border-indigo-200 dark:shadow-indigo-300',
  },
  {
    value: 'stone',
    label: 'Stone',
    class:
      'border-stone-300 bg-stone-100 hover:border-stone-600 hover:bg-stone-500 dark:border-stone-600 dark:bg-stone-700',
    activeClass:
      'border-stone-800 bg-stone-500 shadow-stone-500 dark:border-stone-200 dark:shadow-stone-300',
  },
];

type ColorSwatchRowProps = {
  value: ProjectColor | undefined;
  onChange: (color: ProjectColor) => void;
  className?: string;
};

/** The row of colour dots used by project edit forms. */
export const ColorSwatchRow = ({
  value,
  onChange,
  className,
}: ColorSwatchRowProps) => (
  <div className={`flex gap-1 ${className ?? ''}`}>
    {swatches.map((swatch) => (
      <div
        key={swatch.value}
        onClick={(e) => {
          e.stopPropagation();
          onChange(swatch.value);
        }}
        className={`h-4 w-4 cursor-pointer rounded-full border transition-colors ${
          value === swatch.value
            ? `shadow-xs ${swatch.activeClass}`
            : swatch.class
        }`}
        title={swatch.label}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            onChange(swatch.value);
          }
        }}
      />
    ))}
  </div>
);
