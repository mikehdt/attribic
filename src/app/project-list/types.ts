export type ProjectColor =
  'slate' | 'rose' | 'amber' | 'teal' | 'sky' | 'indigo' | 'stone';

export type Project = {
  name: string;
  path: string;
  imageCount?: number;
  title?: string;
  color?: ProjectColor;
  thumbnail?: string;
  thumbnailVersion?: number;
  featured?: boolean;
  hidden?: boolean;
  private?: boolean;
  captionMode?: 'tags' | 'sentences' | 'caption';
  triggerPhrases?: string[];
};
