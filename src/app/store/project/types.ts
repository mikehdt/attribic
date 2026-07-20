type ProjectInfo = {
  projectName?: string;
  projectPath?: string;
  projectFolderName?: string;
  projectHasThumbnail?: boolean;
  /** Cache-buster for the thumbnail URL, which is otherwise cached hard. */
  projectThumbnailVersion?: number;
};

export type CaptionMode = 'tags' | 'sentences' | 'caption' | 'hybrid';

export enum TagSortType {
  SORTABLE = 'SORTABLE',
  ALPHABETICAL = 'ALPHABETICAL',
  FREQUENCY = 'FREQUENCY',
}

export enum TagSortDirection {
  ASC = 'ASC',
  DESC = 'DESC',
}

type ProjectConfig = {
  showCropVisualization: boolean;
  tagSortType: TagSortType;
  tagSortDirection: TagSortDirection;
  captionMode: CaptionMode;
  triggerPhrases: string[];
  /**
   * The project's canonical natural-language captioning prompt, authored from
   * the project menu. `null` means the user has never written one, so runs fall
   * back to `DEFAULT_VLM_OPTIONS.prompt`. Per-run edits in the captioning modal
   * never write back here — only the modal does.
   */
  captionPrompt: string | null;
};

export type ProjectState = {
  info: ProjectInfo;
  config: ProjectConfig;
};
