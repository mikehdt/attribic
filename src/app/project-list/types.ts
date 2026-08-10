import type { ProjectColor } from '@/app/shared/project-colors';
import type { CaptionMode } from '@/app/store/project/types';

export type Project = {
  name: string;
  path: string;
  imageCount?: number;
  title?: string;
  color?: ProjectColor;
  /** Whether a thumbnail exists; its path is derived from the project name. */
  thumbnail?: boolean;
  thumbnailVersion?: number;
  featured?: boolean;
  hidden?: boolean;
  private?: boolean;
  /** Keeps the project listed even with no assets in it. */
  showWhenEmpty?: boolean;
  captionMode?: CaptionMode;
  triggerPhrases?: string[];
  captionPrompt?: string;
};
