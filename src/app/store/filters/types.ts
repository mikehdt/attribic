// Types for the filters slice
export enum FilterMode {
  SHOW_ALL = 'ShowAll',
  MATCH_ANY = 'MatchAny',
  MATCH_ALL = 'MatchAll',
  MATCH_NONE = 'MatchNone',
  SELECTED_ASSETS = 'SelectedAssets',
  FOLDER = 'Folder',
  TAGLESS = 'Tagless',
}

/**
 * Within-class combination logic for the new visibility control.
 * Each filter class independently chooses how its selections combine.
 * - OFF: this class does not filter (selections exist but are ignored)
 * - ANY: match any of the selections (OR)
 * - ALL: match all of the selections (AND)
 * - INVERSE: exclude anything matching the selections (NOT)
 */
export enum ClassFilterMode {
  OFF = 'Off',
  ANY = 'Any',
  ALL = 'All',
  INVERSE = 'Inverse',
}

/**
 * Per-class visibility settings. Between classes, logic is always AND.
 * Each class can be OFF (no filtering), or set to ANY/ALL/INVERSE.
 */
export type VisibilitySettings = {
  tags: ClassFilterMode;
  nameSearch: ClassFilterMode;
  sizes: ClassFilterMode;
  buckets: ClassFilterMode;
  extensions: ClassFilterMode;
  subfolders: ClassFilterMode;
  triggerPhrases: ClassFilterMode;
  // Scope flags — boolean on/off, ANDed with everything
  scopeTagless: boolean;
  scopeSelected: boolean;
  // Modified — boolean on/off
  showModified: boolean;
};

export enum PaginationSize {
  TWENTY_FIVE = 25,
  FIFTY = 50,
  ONE_HUNDRED = 100,
  TWO_HUNDRED = 200,
  ALL = -1,
}

export type Filters = {
  filterMode: FilterMode;
  filterTags: string[];
  filterSizes: string[];
  filterBuckets: string[];
  filterExtensions: string[];
  filterSubfolders: string[];
  filenamePatterns: string[];
  paginationSize: PaginationSize;
  visibility: VisibilitySettings;
};

/** Filter classes that hold a plain list of active string values. */
export type FilterArrayKey =
  | 'filterTags'
  | 'filterSizes'
  | 'filterBuckets'
  | 'filterExtensions'
  | 'filterSubfolders';

export type FilterCount = {
  tags: number;
  sizes: number;
  buckets: number;
  extensions: number;
  subfolders: number;
  filenamePatterns: number;
  total: number;
};
