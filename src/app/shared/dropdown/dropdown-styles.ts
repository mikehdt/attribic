/**
 * Trigger and menu styling shared by <Dropdown> (a listbox of options) and
 * <DropdownButton> (an arbitrary popup panel). Keeping them here means the two
 * always look like the same control.
 */

/** Size options for a dropdown trigger */
export type DropdownSize = 'sm' | 'md' | 'lg' | 'toolbar';

/**
 * Visual variant for a dropdown trigger
 * - default: border, background and shadow always visible
 * - ghost: transparent until hover/open, then shows background and shadow
 */
export type DropdownVariant = 'default' | 'ghost';

/** Padding and text size per trigger size */
export const dropdownSizeClass: Record<DropdownSize, string> = {
  sm: 'px-2 py-1 text-sm',
  md: 'px-2.5 py-1.5 text-sm',
  lg: 'px-4 py-2 text-base',
  toolbar: 'px-2 py-1 text-sm',
};

const variantStyles = (variant: DropdownVariant, isOpen: boolean) =>
  variant === 'ghost'
    ? `border border-transparent hover:inset-shadow-xs hover:inset-shadow-white dark:hover:inset-shadow-white/10 ${
        isOpen
          ? 'border-slate-300 bg-white shadow-sm inset-shadow-xs inset-shadow-white dark:border-slate-700 dark:bg-slate-700 dark:inset-shadow-white/10'
          : 'bg-transparent hover:border-slate-300 hover:bg-slate-100 hover:shadow-sm dark:hover:border-slate-700 dark:hover:bg-slate-600'
      }`
    : `border border-slate-300 inset-shadow-xs inset-shadow-white dark:border-slate-700 dark:inset-shadow-white/10 ${
        isOpen
          ? 'bg-white shadow-sm dark:bg-slate-700'
          : 'bg-slate-100 shadow-sm hover:bg-slate-200 dark:bg-slate-600 dark:hover:bg-slate-500'
      }`;

/**
 * Classes for a dropdown trigger button. Layout (flex, width, gap) is left to
 * the caller — this covers the chrome only.
 */
export const dropdownTriggerClass = ({
  size = 'md',
  variant = 'default',
  isOpen = false,
}: {
  size?: DropdownSize;
  variant?: DropdownVariant;
  isOpen?: boolean;
}) =>
  `cursor-pointer rounded-sm whitespace-nowrap transition-colors ${dropdownSizeClass[size]} ${variantStyles(variant, isOpen)}`;

/** Classes for the popup surface a dropdown trigger opens */
export const DROPDOWN_MENU_CLASS =
  'rounded-md border border-slate-200 bg-white shadow-md shadow-slate-600/50 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:shadow-slate-950/50';
