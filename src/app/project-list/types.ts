import type { CaptionMode } from '@/app/store/project/types';

export type ProjectColor =
  'slate' | 'rose' | 'amber' | 'teal' | 'sky' | 'indigo' | 'stone';

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
  captionMode?: CaptionMode;
  triggerPhrases?: string[];
  captionPrompt?: string;
};
