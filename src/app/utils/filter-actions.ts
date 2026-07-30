import {
  type ImageAsset,
  SortDirection,
  SortType,
  TagState,
} from '../store/assets';
import { isAssetDirty } from '../store/assets/helpers';
import { hasState } from '../store/assets/utils';
import { ClassFilterMode, type VisibilitySettings } from '../store/filters';
import type { CaptionMode } from '../store/project/types';
import { composeDimensions, naturalCompare } from './helpers';

/**
 * Apply visibility-based filtering using per-class modes.
 * Each class independently uses ANY/ALL/INVERSE logic; between classes is AND.
 * Scope flags (tagless, selected, modified) are ANDed with everything.
 */
export const applyVisibilityFilters = ({
  assets,
  filterTags,
  filterSizes,
  filterBuckets,
  filterExtensions,
  filterSubfolders,
  filenamePatterns,
  visibility,
  selectedAssets,
  sortType,
  sortDirection,
  captionMode,
  triggerPhrases,
}: {
  assets: ImageAsset[];
  filterTags: string[];
  filterSizes: string[];
  filterBuckets: string[];
  filterExtensions: string[];
  filterSubfolders: string[];
  filenamePatterns: string[];
  visibility: VisibilitySettings;
  selectedAssets: string[];
  sortType?: SortType;
  sortDirection?: SortDirection;
  captionMode?: CaptionMode;
  triggerPhrases?: string[];
}): ImageAsset[] => {
  // Sort first, operating on raw asset references (no spreading yet)
  const sortedAssets = applySorting(
    assets,
    sortType,
    sortDirection,
    selectedAssets,
    {
      filterTags,
      filterSizes,
      filterBuckets,
      filterExtensions,
      filterSubfolders,
    },
  );

  // Pre-compute sets for fast lookups
  const filterSizesSet = new Set(filterSizes);
  const filterBucketsSet = new Set(filterBuckets);
  const filterExtensionsSet = new Set(filterExtensions);
  const filterSubfoldersSet = new Set(filterSubfolders);
  const selectedSet = new Set(selectedAssets);
  const triggerSet =
    triggerPhrases && triggerPhrases.length > 0
      ? new Set(triggerPhrases.map((p) => p.toLowerCase()))
      : null;
  const triggerPhrasesLower =
    triggerPhrases && triggerPhrases.length > 0
      ? triggerPhrases.map((p) => p.toLowerCase())
      : null;

  // Helper: check a multi-value class (tags, name search) against an asset
  const checkClass = (
    mode: ClassFilterMode,
    matchAny: () => boolean,
    matchAll: () => boolean,
  ): boolean => {
    if (mode === ClassFilterMode.OFF) return true;
    if (mode === ClassFilterMode.ANY) return matchAny();
    if (mode === ClassFilterMode.ALL) return matchAll();
    // INVERSE: pass if NONE match (i.e. ANY would be false)
    return !matchAny();
  };

  // Helper: check a single-value class (sizes, buckets, extensions, subfolders)
  // For single-value properties, ANY === ALL, so only one test is needed
  const checkSingleValue = (
    mode: ClassFilterMode,
    matches: boolean,
  ): boolean => {
    if (mode === ClassFilterMode.OFF) return true;
    if (mode === ClassFilterMode.INVERSE) return !matches;
    return matches;
  };

  const filteredAssets = sortedAssets.filter((img: ImageAsset) => {
    // --- Scope filters (ANDed with everything) ---

    // Scope: tagless/uncaptioned — only assets with no persisted tags (or empty caption)
    if (visibility.scopeTagless) {
      const hasCaption = !!img.captionText?.trim();
      const hasPersistedTags = img.tagList.some(
        (tag) =>
          !hasState(img.tagStatus[tag], TagState.TO_DELETE) &&
          !hasState(img.tagStatus[tag], TagState.TO_ADD),
      );

      if (captionMode === 'caption') {
        if (hasCaption) return false;
      } else if (captionMode === 'hybrid') {
        // Empty only when neither the tag block nor the caption has content.
        if (hasPersistedTags || hasCaption) return false;
      } else {
        if (hasPersistedTags) return false;
      }
    }

    // Scope: selected only
    if (visibility.scopeSelected) {
      if (!selectedSet.has(img.fileId)) return false;
    }

    // Scope: modified only
    if (visibility.showModified) {
      if (!isAssetDirty(img, captionMode ?? 'tags')) return false;
    }

    // --- Per-class filters (AND between classes) ---

    // Tags class — skip when scopeTagless is on (tagless assets have no tags to filter)
    if (!visibility.scopeTagless && filterTags.length > 0) {
      const passes = checkClass(
        visibility.tags,
        () => filterTags.some((tag) => img.tagList.includes(tag)),
        () => filterTags.every((tag) => img.tagList.includes(tag)),
      );
      if (!passes) return false;
    }

    // Name search class
    if (filenamePatterns.length > 0) {
      const lowerFilename = img.fileId.toLowerCase();
      const passes = checkClass(
        visibility.nameSearch,
        () => filenamePatterns.some((p) => lowerFilename.includes(p)),
        () => filenamePatterns.every((p) => lowerFilename.includes(p)),
      );
      if (!passes) return false;
    }

    // Sizes class
    if (filterSizes.length > 0) {
      const matches = filterSizesSet.has(composeDimensions(img.dimensions));
      if (!checkSingleValue(visibility.sizes, matches)) return false;
    }

    // Buckets class
    if (filterBuckets.length > 0) {
      const matches = filterBucketsSet.has(
        `${img.bucket.width}×${img.bucket.height}`,
      );
      if (!checkSingleValue(visibility.buckets, matches)) return false;
    }

    // Extensions class
    if (filterExtensions.length > 0) {
      if (
        !checkSingleValue(
          visibility.extensions,
          filterExtensionsSet.has(img.fileExtension),
        )
      )
        return false;
    }

    // Subfolders class
    if (filterSubfolders.length > 0) {
      const matches = !!img.subfolder && filterSubfoldersSet.has(img.subfolder);
      if (!checkSingleValue(visibility.subfolders, matches)) return false;
    }

    // Trigger phrases class — selections come from project config, not filter state
    if (triggerSet && triggerPhrasesLower) {
      const passes = checkClass(
        visibility.triggerPhrases,
        () => {
          if (captionMode === 'caption') {
            const lowerCaption = img.captionText?.toLowerCase() ?? '';
            return triggerPhrasesLower.some((p) => lowerCaption.includes(p));
          }
          if (captionMode === 'hybrid') {
            // Match a phrase as an exact booru tag OR anywhere in the caption.
            const lowerCaption = img.captionText?.toLowerCase() ?? '';
            return triggerPhrasesLower.some(
              (p) =>
                triggerSet.has(p) ||
                lowerCaption.includes(p) ||
                img.tagList.some((tag) => tag.toLowerCase() === p),
            );
          }
          // tags mode: exact match
          return img.tagList.some((tag) => triggerSet.has(tag.toLowerCase()));
        },
        () => {
          if (captionMode === 'caption') {
            const lowerCaption = img.captionText?.toLowerCase() ?? '';
            return triggerPhrasesLower.every((p) => lowerCaption.includes(p));
          }
          if (captionMode === 'hybrid') {
            const lowerCaption = img.captionText?.toLowerCase() ?? '';
            return triggerPhrasesLower.every(
              (p) =>
                lowerCaption.includes(p) ||
                img.tagList.some((tag) => tag.toLowerCase() === p),
            );
          }
          // tags mode: exact match
          return triggerPhrasesLower.every((p) =>
            img.tagList.some((tag) => tag.toLowerCase() === p),
          );
        },
      );
      if (!passes) return false;
    }

    return true;
  });

  return filteredAssets;
};

/**
 * Apply sorting to an array of assets
 */
const applySorting = (
  assets: ImageAsset[],
  sortType?: SortType,
  sortDirection?: SortDirection,
  selectedAssets?: string[],
  filterCriteria?: {
    filterTags: string[];
    filterSizes: string[];
    filterBuckets: string[];
    filterExtensions: string[];
    filterSubfolders?: string[];
  },
): ImageAsset[] => {
  if (!sortType || !sortDirection) {
    return assets; // Return unsorted if no sort parameters
  }

  const selectedSet = new Set(selectedAssets || []);
  const direction = sortDirection === SortDirection.ASC ? 1 : -1;

  // For FILTERED sort, pre-compute which assets match the filter criteria
  let filteredSet: Set<string> | null = null;
  if (sortType === SortType.FILTERED && filterCriteria) {
    filteredSet = new Set<string>();
    const {
      filterTags,
      filterSizes,
      filterBuckets,
      filterExtensions,
      filterSubfolders,
    } = filterCriteria;
    const safeFilterSubfolders = filterSubfolders || [];
    const filterSizesSet = new Set(filterSizes);
    const filterBucketsSet = new Set(filterBuckets);
    const filterExtensionsSet = new Set(filterExtensions);
    const filterSubfoldersSet = new Set(safeFilterSubfolders);

    for (const asset of assets) {
      const dimensionsComposed = composeDimensions(asset.dimensions);
      const bucketComposed = `${asset.bucket.width}×${asset.bucket.height}`;

      // Check if asset matches ANY filter criterion (MATCH_ANY logic)
      const anyTagMatches =
        filterTags.length > 0 &&
        filterTags.some((tag) => asset.tagList.includes(tag));
      const anySizeMatches =
        filterSizes.length > 0 && filterSizesSet.has(dimensionsComposed);
      const anyBucketMatches =
        filterBuckets.length > 0 && filterBucketsSet.has(bucketComposed);
      const anyExtensionMatches =
        filterExtensions.length > 0 &&
        filterExtensionsSet.has(asset.fileExtension);
      const anySubfolderMatches =
        safeFilterSubfolders.length > 0 &&
        asset.subfolder &&
        filterSubfoldersSet.has(asset.subfolder);

      if (
        anyTagMatches ||
        anySizeMatches ||
        anyBucketMatches ||
        anyExtensionMatches ||
        anySubfolderMatches
      ) {
        filteredSet.add(asset.fileId);
      }
    }
  }

  return [...assets].sort((a, b) => {
    let comparison = 0;

    switch (sortType) {
      case SortType.NAME:
        comparison = naturalCompare(a.fileId, b.fileId);
        break;

      case SortType.IMAGE_SIZE:
        // Sort by image dimensions (width first, then height) to match size view logic
        if (a.dimensions.width !== b.dimensions.width) {
          comparison = a.dimensions.width - b.dimensions.width;
        } else {
          comparison = a.dimensions.height - b.dimensions.height;
        }
        break;

      case SortType.BUCKET_SIZE:
        // Sort by bucket dimensions (width first, then height) to match bucket view logic
        if (a.bucket.width !== b.bucket.width) {
          comparison = a.bucket.width - b.bucket.width;
        } else {
          comparison = a.bucket.height - b.bucket.height;
        }
        break;

      case SortType.SCALED:
        // Sort by scaling relationship between image and bucket
        // Priority: 1. Identical size, 2. Same aspect ratio, 3. Different aspect ratio
        // Within each category, sort alphabetically by asset name

        // Calculate scaling categories for both assets
        const getCategoryAndSecondary = (asset: ImageAsset) => {
          const imageDims = asset.dimensions;
          const bucketDims = asset.bucket;

          // Check if dimensions are identical
          if (
            imageDims.width === bucketDims.width &&
            imageDims.height === bucketDims.height
          ) {
            return { category: 0, secondary: asset.fileId }; // Identical - highest priority
          }

          // Check if aspect ratios are identical (within small tolerance for floating point)
          const imageAspectRatio = imageDims.width / imageDims.height;
          const bucketAspectRatio = bucketDims.width / bucketDims.height;
          const aspectRatioTolerance = 0.001;

          if (
            Math.abs(imageAspectRatio - bucketAspectRatio) <
            aspectRatioTolerance
          ) {
            return { category: 1, secondary: asset.fileId }; // Same aspect ratio - medium priority
          }

          // Different aspect ratio - lowest priority
          return { category: 2, secondary: asset.fileId };
        };

        const aCategoryData = getCategoryAndSecondary(a);
        const bCategoryData = getCategoryAndSecondary(b);

        // First compare by category
        if (aCategoryData.category !== bCategoryData.category) {
          comparison = aCategoryData.category - bCategoryData.category;
        } else {
          // Within the same category, sort naturally by filename
          comparison = naturalCompare(
            aCategoryData.secondary,
            bCategoryData.secondary,
          );
        }
        break;

      case SortType.SELECTED:
        // Sort selected assets first
        const aSelected = selectedSet.has(a.fileId);
        const bSelected = selectedSet.has(b.fileId);
        if (aSelected && !bSelected) comparison = -1;
        else if (!aSelected && bSelected) comparison = 1;
        else comparison = 0;
        break;

      case SortType.FILTERED:
        // Sort filtered assets first (those matching any filter criterion)
        if (filteredSet) {
          const aFiltered = filteredSet.has(a.fileId);
          const bFiltered = filteredSet.has(b.fileId);
          if (aFiltered && !bFiltered) comparison = -1;
          else if (!aFiltered && bFiltered) comparison = 1;
          else comparison = 0;
        }
        break;

      case SortType.FOLDER: {
        // Subfolder assets always come first, root assets last (regardless of direction)
        const aInFolder = !!a.subfolder;
        const bInFolder = !!b.subfolder;

        if (aInFolder && !bInFolder) return -1;
        if (!aInFolder && bInFolder) return 1;

        // Both in subfolders: sort by subfolder name, then by filename within same folder
        if (aInFolder && bInFolder) {
          const folderCmp = naturalCompare(a.subfolder!, b.subfolder!);
          if (folderCmp !== 0) return folderCmp * direction;
          return naturalCompare(a.fileId, b.fileId) * direction;
        }

        // Both in root: sort by filename
        return naturalCompare(a.fileId, b.fileId) * direction;
      }

      default:
        comparison = 0;
        break;
    }

    return comparison * direction;
  });
};
