export interface AssetImportState {
  /**
   * Whether the importer is open with nothing gathered yet — the route in from
   * the project menu, where the page offers no visible drop target of its own.
   */
  isOpen: boolean;
  /**
   * Bumped to ask for the file picker directly, skipping the drop zone. A
   * counter rather than a flag because opening the picker is an event, not a
   * state the app can sit in — there's nothing to unwind if the user dismisses
   * the dialog.
   */
  pickRequestId: number;
}
