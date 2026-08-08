export type ThemeMode = 'light' | 'dark' | 'auto';

export type TrainingViewMode =
  'simple' | 'intermediate' | 'advanced' | 'expert';

export type TaggingViewMode = 'list' | 'grid';

export enum TagEditMode {
  BUTTON = 'BUTTON',
  DOUBLE_CLICK = 'DOUBLE_CLICK',
}

export type PreferencesState = {
  theme: ThemeMode;
  tagEditMode: TagEditMode;
  trainingViewMode: TrainingViewMode;
  /** Tagging gallery renderer: full-detail rows or a compact image grid. */
  taggingViewMode: TaggingViewMode;
  /**
   * Whether to keep auto-tagger models loaded in GPU/CPU memory after a
   * batch completes. When false, the sidecar is asked to release the model
   * after each successful run — frees VRAM at the cost of a reload on the
   * next batch (~15-30s for a VLM). Default true for iteration speed.
   */
  keepTaggerModelInMemory: boolean;
  /**
   * The base model the user last picked in the training form, so a fresh
   * visit reopens on it rather than the registry's first entry. Null until
   * a model is explicitly chosen.
   */
  lastTrainingModelId: string | null;
};
