/**
 * Shared colour vocabulary for project rows — tagging projects persist it in
 * `.tagging/project.json`, training projects in their `meta.json`. The values
 * line up with the Button component's colour variants, so a stored colour can
 * be passed straight through as `color`.
 */
const PROJECT_COLORS = [
  'slate',
  'rose',
  'amber',
  'teal',
  'sky',
  'indigo',
  'stone',
] as const;

export type ProjectColor = (typeof PROJECT_COLORS)[number];

export const isProjectColor = (value: unknown): value is ProjectColor =>
  PROJECT_COLORS.includes(value as ProjectColor);

/** Small indicator-dot classes for surfaces too dense for a full tinted row. */
export const PROJECT_COLOR_DOT_CLASSES: Record<ProjectColor, string> = {
  slate: 'bg-slate-400',
  rose: 'bg-rose-400',
  amber: 'bg-amber-400',
  teal: 'bg-teal-400',
  sky: 'bg-sky-400',
  indigo: 'bg-indigo-400',
  stone: 'bg-stone-400',
};
