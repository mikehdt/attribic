import { forwardRef } from 'react';

export type InputSize = 'xs' | 'sm' | 'md' | 'lg' | 'toolbar';

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  size?: InputSize;
};

const sizeClasses: Record<InputSize, string> = {
  xs: 'px-1 py-0.5 text-xs',
  sm: 'px-2 py-1 text-sm',
  md: 'px-3 py-1.5 text-sm',
  lg: 'px-4 py-2 text-base',
  toolbar: 'px-2 py-1 text-sm',
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ size = 'md', className = '', type, ...props }, ref) => {
    const numericClass = type === 'number' ? 'pr-0 tabular-nums' : '';

    return (
      <input
        ref={ref}
        type={type}
        className={`rounded-sm border border-slate-300 bg-white text-(--foreground) placeholder:text-slate-400 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 ${sizeClasses[size]} ${numericClass} ${className}`}
        {...props}
      />
    );
  },
);

Input.displayName = 'Input';
