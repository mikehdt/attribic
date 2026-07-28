// Types for the assets slice
export enum IoState {
  INITIAL = 'Initial',
  LOADING = 'Loading',
  SAVING = 'Saving',
  COMPLETING = 'Completing', // Brief state to show 100% progress before transitioning to complete
  COMPLETE = 'Complete',
  ERROR = 'IoError',
}

// Using bitwise flags instead of string enum to allow combined states
export enum TagState {
  SAVED = 0, // 0000 - Base state
  TO_DELETE = 1, // 0001 - Marked for deletion
  TO_ADD = 2, // 0010 - Newly added
  DIRTY = 4, // 0100 - Position changed
}

export enum SortType {
  NAME = 'Name',
  IMAGE_SIZE = 'ImageSize',
  BUCKET_SIZE = 'BucketSize',
  SCALED = 'Scaled',
  SELECTED = 'Selected',
  FILTERED = 'Filtered',
  FOLDER = 'Folder',
}

export enum SortDirection {
  ASC = 'asc',
  DESC = 'desc',
}

export type ImageDimensions = {
  width: number;
  height: number;
};

export type KohyaBucket = {
  width: number;
  height: number;
  aspectRatio: number;
};

export type ImageAsset = {
  ioState: Extract<IoState, IoState.SAVING | IoState.COMPLETE | IoState.ERROR>;
  fileId: string;
  fileExtension: string;
  subfolder?: string; // Repeat folder name (e.g., "2_sonic"), undefined for root
  dimensions: ImageDimensions;
  bucket: KohyaBucket;
  tagStatus: { [key: string]: number }; // Changed from TagState to number to support bit flags
  tagList: string[];
  savedTagList: string[]; // Original tag order from last save
  captionText: string; // Raw text from .txt file (for caption mode)
  savedCaptionText: string; // Last-saved caption text (for dirty detection)
  lastModified: number; // Unix timestamp for cache busting
  blurDataUrl?: string; // Base64 data URL for blur placeholder (max 10px)
};

export type SaveProgress = {
  total: number;
  completed: number;
  failed: number;
  errors?: string[]; // List of fileIds that failed to save
};

export type LoadProgress = {
  total: number;
  completed: number;
  failed: number;
  errors?: string[]; // List of fileIds that failed to load
};

export type ImageAssets = {
  ioState: IoState;
  ioMessage: undefined | string;
  images: ImageAsset[];
  imageIndexById: { [fileId: string]: number }; // Lookup map for O(1) asset access
  // Cached tag counts - null means cache is invalidated and needs rebuild
  // This is rebuilt lazily by selectors when accessed after invalidation
  tagCountsCache: KeyedCountList | null;
  saveProgress?: SaveProgress;
  loadProgress?: LoadProgress;
  // Sorting state
  sortType: SortType;
  sortDirection: SortDirection;
};

export type KeyedCountList = { [key: string]: number };

export type SaveAssetResult = {
  assetIndex: number;
  fileId: string;
  tagList: string[];
  tagStatus: { [key: string]: number };
  savedTagList: string[];
  captionText?: string;
  savedCaptionText?: string;
};
