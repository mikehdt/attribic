type SectionHeaderExtraProps = {
  /** Whether any of the section's visible fields differ from the baseline. */
  hasChanges?: boolean;
  /**
   * Fields in this section customised away from their model default but hidden
   * at the current expertise tier. Worth calling out: the tier is concealing
   * settings the run will still act on.
   */
  hiddenChangesCount?: number;
};

/**
 * The `headerExtra` content every collapsible form section shares — a change
 * dot plus a count of customised-but-hidden settings. Sections that offer no
 * reset affordance (Model, Sampling, Saving) simply omit `hasChanges`.
 */
export const SectionHeaderExtra = ({
  hasChanges,
  hiddenChangesCount,
}: SectionHeaderExtraProps) => (
  <>
    {hasChanges && <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />}
    {hiddenChangesCount ? (
      <span className="text-xs text-amber-500/70">
        {hiddenChangesCount} hidden{' '}
        {hiddenChangesCount === 1 ? 'setting' : 'settings'} customised
      </span>
    ) : undefined}
  </>
);
