export type ProjectListState = {
  showHidden: boolean;
  newProjectOpen: boolean;
  projectsFolder: string;
  /**
   * Bumped to ask the start page to refetch its project lists. The refresh
   * controls live in the top shelf while the lists live in the page body, so
   * the request travels through the store rather than through props.
   */
  refreshToken: number;
};
