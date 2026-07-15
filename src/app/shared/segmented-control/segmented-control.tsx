import { ReactNode } from 'react';

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  icon?: ReactNode;
};

type SegmentedControlSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'toolbar';

type SegmentedControlTone = 'default' | 'surface';

type SegmentedControlProps<T extends string> = {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  size?: SegmentedControlSize;
  width?: 'inline' | 'full';
  /** Shadow tone. 'default' is subtler for page backgrounds; 'surface' is brighter for menus/cards. */
  tone?: SegmentedControlTone;
  className?: string;
};

const sizeClasses: Record<
  SegmentedControlSize,
  { container: string; button: string }
> = {
  xs: {
    container: 'text-xs shadow-xs inset-shadow-xs',
    button: 'px-2 py-0.5 [&_svg]:w-4',
  },
  sm: {
    container: 'text-sm shadow-xs inset-shadow-xs',
    button: 'px-2 py-1 [&_svg]:w-4',
  },
  md: {
    container: 'text-sm shadow-sm inset-shadow-sm',
    button: 'px-4 py-1.5 [&_svg]:w-4',
  },
  lg: {
    container: 'text-sm shadow-sm inset-shadow-sm',
    button: 'px-4 py-1.5 [&_svg]:w-4',
  },
  xl: {
    container: 'text-base shadow-md inset-shadow-sm',
    button: 'px-4 py-2 [&_svg]:w-4',
  },
  toolbar: {
    container: 'text-sm shadow-sm inset-shadow-sm',
    button: 'px-4 py-1 [&_svg]:w-4',
  },
};

const toneClasses: Record<SegmentedControlTone, string> = {
  default:
    'shadow-white inset-shadow-slate-300 dark:shadow-slate-900 dark:inset-shadow-slate-800',
  surface:
    'shadow-white  inset-shadow-slate-300 dark:shadow-slate-600 dark:inset-shadow-slate-800',
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  size = 'md',
  width = 'inline',
  tone = 'default',
  className = '',
}: SegmentedControlProps<T>) {
  const sizes = sizeClasses[size];

  return (
    <div
      className={`${width === 'full' ? 'flex w-full' : 'inline-flex'} items-center rounded-sm border border-white/0 bg-slate-100 dark:border-slate-600 dark:bg-slate-700 ${toneClasses[tone]} ${sizes.container} ${disabled ? 'pointer-events-none opacity-40' : ''} ${className}`}
    >
      {options.map((option, index) => {
        const isSelected = value === option.value;
        const isFirst = index === 0;
        const isLast = index === options.length - 1;

        const roundedClasses = isFirst
          ? 'rounded-l-sm'
          : isLast
            ? 'rounded-r-sm'
            : '';

        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-pressed={isSelected}
            onClick={() => onChange(option.value)}
            title={option.label}
            className={`flex flex-auto cursor-pointer items-center justify-center gap-1 transition-colors ${sizes.button} ${roundedClasses} ${
              isSelected
                ? 'z-10 bg-white shadow-sm shadow-slate-300 dark:bg-slate-500 dark:inset-shadow-xs dark:shadow-slate-500 dark:inset-shadow-slate-400'
                : 'text-slate-400 hover:bg-slate-300 hover:text-slate-500 dark:text-slate-400 dark:hover:bg-slate-500 dark:hover:text-slate-300'
            }`}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
