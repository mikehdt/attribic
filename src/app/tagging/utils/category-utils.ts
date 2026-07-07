import { type ImageAsset, SortDirection, SortType } from '@/app/store/assets';
import { parseSubfolder } from '@/app/utils/subfolder-utils';

// Constants for sort category names
const SCALED_CATEGORIES = {
  EQUAL_SIZE: 'Equal Size',
  SAME_ASPECT: 'Scaled (Same Aspect)',
  DIFFERENT: 'Scaled',
} as const;

const SELECTED_CATEGORIES = {
  SELECTED: 'Selected',
  NOT_SELECTED: 'Not Selected',
} as const;

// Create arrays of the category values for sorting
const SCALED_ORDER = Object.values(SCALED_CATEGORIES);
const SELECTED_ORDER = Object.values(SELECTED_CATEGORIES);

// Helper functions for type-safe category ordering
const getScaledCategoryIndex = (category: string): number => {
  return SCALED_ORDER.findIndex((cat) => cat === category);
};

const getSelectedCategoryIndex = (category: string): number => {
  return SELECTED_ORDER.findIndex((cat) => cat === category);
};

// Function to get sort category for an asset
export const getSortCategory = (
  asset: ImageAsset,
  sortType: SortType,
  selectedAssets: string[],
): string => {
  switch (sortType) {
    case SortType.NAME:
      // Extract filename without subfolder prefix for categorization
      // If asset is in a subfolder (e.g., "2_sonic/abc_image"), use only "abc_image"
      let filename = asset.fileId;
      if (asset.subfolder) {
        const slashIndex = asset.fileId.indexOf('/');
        if (slashIndex !== -1) {
          filename = asset.fileId.substring(slashIndex + 1);
        }
      }

      const firstChar = filename.charAt(0).toLowerCase();
      if (firstChar >= '0' && firstChar <= '9') {
        return firstChar;
      } else if (firstChar >= 'a' && firstChar <= 'z') {
        return firstChar.toUpperCase();
      } else {
        // Check if this character sorts before letters using localeCompare
        // We use 'a' as the reference since it's the first letter
        const sortsBefore = firstChar.localeCompare('a') < 0;
        return sortsBefore ? 'Symbols' : 'Other';
      }

    case SortType.IMAGE_SIZE:
      return `${asset.dimensions.width} × ${asset.dimensions.height}`;

    case SortType.BUCKET_SIZE:
      return `${asset.bucket.width} × ${asset.bucket.height}`;

    case SortType.SCALED:
      // Check if dimensions are identical
      if (
        asset.dimensions.width === asset.bucket.width &&
        asset.dimensions.height === asset.bucket.height
      ) {
        return SCALED_CATEGORIES.EQUAL_SIZE;
      }

      // Check if aspect ratios are identical (within tolerance)
      const imageAspectRatio = asset.dimensions.width / asset.dimensions.height;
      const bucketAspectRatio = asset.bucket.width / asset.bucket.height;
      const aspectRatioTolerance = 0.001;

      if (
        Math.abs(imageAspectRatio - bucketAspectRatio) < aspectRatioTolerance
      ) {
        return SCALED_CATEGORIES.SAME_ASPECT;
      }

      return SCALED_CATEGORIES.DIFFERENT;

    case SortType.SELECTED:
      return selectedAssets.includes(asset.fileId)
        ? SELECTED_CATEGORIES.SELECTED
        : SELECTED_CATEGORIES.NOT_SELECTED;

    case SortType.FOLDER:
      // If asset is in a subfolder, use the parsed label as category
      // Otherwise, use "Root" as category
      if (asset.subfolder) {
        const parsed = parseSubfolder(asset.subfolder);
        if (parsed) {
          // Format as "2× sonic" for display
          return `${parsed.repeatCount}× ${parsed.label}`;
        }
        // Fallback if parsing fails (shouldn't happen)
        return asset.subfolder;
      }
      return 'Root';

    default:
      return 'All Assets';
  }
};

// Function to sort categories based on sort type and direction
export const sortCategories = (
  categories: string[],
  sortType: SortType,
  sortDirection: SortDirection,
): string[] => {
  const sorted = [...categories].sort((a, b) => {
    let comparison = 0;

    switch (sortType) {
      case SortType.NAME:
        // Order: Symbols first, then numbers, then letters, then other
        const getOrder = (cat: string) => {
          if (cat === 'Symbols') return 0;
          if (cat.length === 1 && cat >= '0' && cat <= '9') return 1;
          if (cat.length === 1 && cat >= 'A' && cat <= 'Z') return 2;
          return 3; // Other
        };

        const orderA = getOrder(a);
        const orderB = getOrder(b);

        if (orderA !== orderB) {
          comparison = orderA - orderB;
        } else {
          // Within same type, sort alphabetically
          comparison = a.localeCompare(b);
        }
        break;

      case SortType.SCALED:
        // Define order for scaled categories using constants
        const aIndex = getScaledCategoryIndex(a);
        const bIndex = getScaledCategoryIndex(b);
        comparison = aIndex - bIndex;
        break;

      case SortType.SELECTED:
        // Selected first, then not selected using constants
        const aSelectedIndex = getSelectedCategoryIndex(a);
        const bSelectedIndex = getSelectedCategoryIndex(b);
        comparison = aSelectedIndex - bSelectedIndex;
        break;

      case SortType.FOLDER:
        // Subfolders always come first, Root always last (regardless of direction)
        // Primary: repeat count (0-9 ASC, 9-0 DESC), tiebreak: label (always a-z)
        const aIsRoot = a === 'Root';
        const bIsRoot = b === 'Root';

        if (aIsRoot && !bIsRoot) {
          comparison = 1; // Root always last in both modes
        } else if (!aIsRoot && bIsRoot) {
          comparison = -1;
        } else if (!aIsRoot && !bIsRoot) {
          // Both are subfolder categories - parse and compare
          // Format is "2× sonic", extract repeat count and label
          const aMatch = a.match(/^(\d+)×\s+(.+)$/);
          const bMatch = b.match(/^(\d+)×\s+(.+)$/);

          if (aMatch && bMatch) {
            const aRepeat = parseInt(aMatch[1], 10);
            const bRepeat = parseInt(bMatch[1], 10);
            const aLabel = aMatch[2];
            const bLabel = bMatch[2];

            // Primary: repeat count (direction-aware), tiebreak: label (always a-z)
            if (aRepeat !== bRepeat) {
              comparison =
                sortDirection === SortDirection.ASC
                  ? aRepeat - bRepeat
                  : bRepeat - aRepeat;
            } else {
              comparison = aLabel.localeCompare(bLabel);
            }
          } else {
            // Fallback to alphabetical if parsing fails
            comparison = a.localeCompare(b);
          }
        } else {
          // Both are Root - equal
          comparison = 0;
        }
        // Return early for FOLDER to skip the automatic sortDirection reversal below
        return comparison;

      case SortType.IMAGE_SIZE:
      case SortType.BUCKET_SIZE:
        // For size categories, parse dimensions and sort numerically
        const parseDimensions = (cat: string) => {
          const [width, height] = cat.split(' × ').map(Number);
          return { width: width || 0, height: height || 0 };
        };

        const aDims = parseDimensions(a);
        const bDims = parseDimensions(b);

        // Sort by width first, then height
        if (aDims.width !== bDims.width) {
          comparison = aDims.width - bDims.width;
        } else {
          comparison = aDims.height - bDims.height;
        }
        break;

      default:
        comparison = a.localeCompare(b);
        break;
    }

    return sortDirection === SortDirection.ASC ? comparison : -comparison;
  });

  return sorted;
};

/**
 * Group assets into display categories and return them in the exact order they
 * are rendered: categories ordered by `sortCategories`, and assets kept in their
 * incoming order within each category.
 *
 * This is the single source of truth for a page's visual order. Both the grid
 * render and shift-range selection derive their order from here so the range
 * that gets highlighted always matches what's on screen — unlike the raw
 * `selectFilteredAssets` order, which sorts by full fileId and can diverge from
 * the category grouping (e.g. NAME sort buckets a `2_sonic/zebra` subfolder asset
 * under "Z" while the flat sort places it among the leading digits).
 */
export const groupAssetsByCategory = <T extends ImageAsset>(
  assets: T[],
  sortType: SortType,
  sortDirection: SortDirection,
  selectedAssets: string[],
): { category: string; assets: T[] }[] => {
  const groups: { [key: string]: T[] } = {};

  for (const asset of assets) {
    const category = getSortCategory(asset, sortType, selectedAssets);
    (groups[category] ??= []).push(asset);
  }

  const sortedCategories = sortCategories(
    Object.keys(groups),
    sortType,
    sortDirection,
  );

  return sortedCategories.map((category) => ({
    category,
    assets: groups[category],
  }));
};

export interface CategoryInfo {
  category: string;
  page: number;
  firstAssetIndex: number;
  isFirstOccurrence: boolean; // True if this is the first time this category appears
}

// Function to get all categories with their page information
export const getCategoriesWithPageInfo = (
  filteredAssets: ImageAsset[],
  sortType: SortType,
  sortDirection: SortDirection,
  selectedAssets: string[],
  paginationSize: number,
): CategoryInfo[] => {
  // If showing all on one page, use the simpler original logic
  if (paginationSize === -1) {
    return getSimpleCategoriesWithPageInfo(
      filteredAssets,
      sortType,
      sortDirection,
      selectedAssets,
    );
  }

  // Group all assets by category with their indices
  const categoryGroups: { [key: string]: number[] } = {};

  filteredAssets.forEach((asset, index) => {
    const category = getSortCategory(asset, sortType, selectedAssets);
    if (!categoryGroups[category]) {
      categoryGroups[category] = [];
    }
    categoryGroups[category].push(index);
  });

  // Get sorted category names
  const sortedCategories = sortCategories(
    Object.keys(categoryGroups),
    sortType,
    sortDirection,
  );

  // Build a map of which categories appear on which pages
  const categoriesWithPageInfo: CategoryInfo[] = [];
  const seenCategories = new Set<string>();
  let currentIndex = 0;

  for (const category of sortedCategories) {
    const assetIndices = categoryGroups[category];
    const categoryStart = currentIndex;
    const categoryEnd = currentIndex + assetIndices.length - 1;

    // Calculate which pages this category spans
    const startPage = Math.floor(categoryStart / paginationSize) + 1;
    const endPage = Math.floor(categoryEnd / paginationSize) + 1;

    // Add an entry for each page this category appears on
    for (let page = startPage; page <= endPage; page++) {
      const isFirstOccurrence = !seenCategories.has(category);

      categoriesWithPageInfo.push({
        category,
        page,
        firstAssetIndex: categoryStart,
        isFirstOccurrence,
      });

      seenCategories.add(category);
    }

    currentIndex += assetIndices.length;
  }

  return categoriesWithPageInfo;
};

// Simpler version for when all items are on one page
const getSimpleCategoriesWithPageInfo = (
  filteredAssets: ImageAsset[],
  sortType: SortType,
  sortDirection: SortDirection,
  selectedAssets: string[],
): CategoryInfo[] => {
  // Group all assets by category
  const categoryGroups: { [key: string]: number[] } = {};

  filteredAssets.forEach((asset, index) => {
    const category = getSortCategory(asset, sortType, selectedAssets);
    if (!categoryGroups[category]) {
      categoryGroups[category] = [];
    }
    categoryGroups[category].push(index);
  });

  // Get sorted category names
  const sortedCategories = sortCategories(
    Object.keys(categoryGroups),
    sortType,
    sortDirection,
  );

  // Calculate page information for each category
  const categoriesWithPageInfo: CategoryInfo[] = [];
  let currentIndex = 0;

  for (const category of sortedCategories) {
    const assetIndices = categoryGroups[category];
    const firstAssetIndex = currentIndex;

    categoriesWithPageInfo.push({
      category,
      page: 1,
      firstAssetIndex,
      isFirstOccurrence: true,
    });

    currentIndex += assetIndices.length;
  }

  return categoriesWithPageInfo;
};

/**
 * Generate a consistent anchor ID for a category name
 */
export const getCategoryAnchorId = (category: string): string => {
  return `category-${category.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`;
};
