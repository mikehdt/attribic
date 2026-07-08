import { type LucideIcon } from 'lucide-react';
import { type ReactNode } from 'react';

export type ColorScheme =
  'slate' | 'emerald' | 'sky' | 'indigo' | 'stone' | 'green';

interface SectionDividerProps {
  children: ReactNode;
  icon?: LucideIcon;
  color?: ColorScheme;
  className?: string;
}

const lineClasses: Record<ColorScheme, string> = {
  slate: 'bg-slate-200 shadow-white dark:bg-slate-500 dark:shadow-slate-800',
  emerald:
    'bg-emerald-200 shadow-white dark:bg-emerald-700 dark:shadow-emerald-950',
  sky: 'bg-sky-200 shadow-white dark:bg-sky-700 dark:shadow-sky-950',
  indigo:
    'bg-indigo-200 shadow-white dark:bg-indigo-700 dark:shadow-indigo-950',
  stone: 'bg-stone-200 shadow-white dark:bg-stone-500 dark:shadow-stone-800',
  green: 'bg-green-200 shadow-white dark:bg-green-700 dark:shadow-green-950',
};

const textClasses: Record<ColorScheme, string> = {
  slate: 'text-slate-400 text-shadow-white dark:text-shadow-slate-900',
  emerald: 'text-emerald-500 text-shadow-white dark:text-shadow-emerald-950',
  sky: 'text-sky-400 text-shadow-white dark:text-shadow-sky-950',
  indigo: 'text-indigo-400 text-shadow-white dark:text-shadow-indigo-950',
  stone: 'text-stone-400 text-shadow-white dark:text-shadow-stone-900',
  green: 'text-green-500 text-shadow-white dark:text-shadow-green-950',
};

export const SectionDivider = ({
  children,
  icon: Icon,
  color = 'slate',
  className = '',
}: SectionDividerProps) => {
  return (
    <div className={`flex cursor-default items-center gap-2 ${className}`}>
      <span className={`h-px flex-1 shadow-2xs ${lineClasses[color]}`} />
      <span
        className={`flex items-center gap-1 text-xs text-shadow-xs ${textClasses[color]}`}
      >
        {Icon && <Icon className="h-4 w-4" />}
        {children}
      </span>
      <span className={`h-px flex-1 shadow-2xs ${lineClasses[color]}`} />
    </div>
  );
};
