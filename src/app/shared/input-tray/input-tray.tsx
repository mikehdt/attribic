import type { ReactNode } from 'react';

type InputTraySize = 'sm' | 'md' | 'lg';
type InputTrayWidth = 'inline' | 'full';
type Gap = 'none' | 'sm' | 'md';

type InputTrayProps = {
  children: ReactNode;
  size?: InputTraySize;
  width?: InputTrayWidth;
  className?: string;
  gap?: Gap;
};

const sizeClasses: Record<InputTraySize, string> = {
  sm: 'rounded-sm',
  md: 'p-0.5 rounded-md',
  lg: 'p-1 rounded-lg',
};

const gapClasses: Record<Gap, string> = {
  none: '',
  sm: 'gap-1',
  md: 'gap-2',
};

export function InputTray({
  children,
  size = 'sm',
  width = 'inline',
  className = '',
  gap = 'none',
}: InputTrayProps) {
  return (
    <div
      className={`${width === 'full' ? 'flex w-full' : 'inline-flex'} items-center bg-slate-200 inset-shadow-xs inset-shadow-slate-300 dark:bg-slate-800 dark:inset-shadow-slate-900 ${gapClasses[gap]} ${sizeClasses[size]} ${className}`}
    >
      {children}
    </div>
  );
}
