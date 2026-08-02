/** Shared row styling for the project menu's action and list items. */
export const MENU_ITEM_CLASS =
  'flex cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700';

/** Disabled counterpart of MENU_ITEM_CLASS — no hover, muted text. */
export const MENU_ITEM_DISABLED_CLASS =
  'flex cursor-not-allowed items-center gap-2 px-3 py-2 text-left text-sm text-slate-300 dark:text-slate-500';

/** Section heading above a group of list items (recent projects, runs). */
export const MENU_HEADING_CLASS =
  'px-3 py-1 text-sm font-medium text-slate-400 dark:text-slate-500';
