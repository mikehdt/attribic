import {
  ArchiveIcon,
  FileImageIcon,
  FileSearchIcon,
  FolderOpenIcon,
  HighlighterIcon,
  ImageIcon,
  type LucideIcon,
  SwatchBookIcon,
} from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { type ColorScheme } from '@/app/shared/section-divider/section-divider';
import {
  selectHasModifiedAssets,
  selectHasTaglessAssets,
} from '@/app/store/assets';
import {
  ClassFilterMode,
  selectFilterCount,
  selectVisibility,
  setVisibilityClassMode,
  toggleVisibilityModified,
  toggleVisibilityScopeSelected,
  toggleVisibilityScopeTagless,
} from '@/app/store/filters';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import { selectTriggerPhrases } from '@/app/store/project';
import { selectSelectedAssetsCount } from '@/app/store/selection';

type VisibilityClassKey =
  | 'tags'
  | 'nameSearch'
  | 'sizes'
  | 'buckets'
  | 'extensions'
  | 'subfolders'
  | 'triggerPhrases';

export type SectionConfig = {
  key: VisibilityClassKey;
  label: string;
  icon: LucideIcon;
  color: ColorScheme;
  count: number;
  mode: ClassFilterMode;
  available: boolean;
  emptyCategory: string;
};

export const useVisibilityControl = () => {
  const dispatch = useAppDispatch();

  const visibility = useAppSelector(selectVisibility);
  // Single memoised selector for all filter counts — avoids 6 array subscriptions
  const filterCount = useAppSelector(selectFilterCount);
  const selectedAssetsCount = useAppSelector(selectSelectedAssetsCount);
  const hasTaglessAssets = useAppSelector(selectHasTaglessAssets);
  const hasModifiedAssets = useAppSelector(selectHasModifiedAssets);
  const triggerPhrases = useAppSelector(selectTriggerPhrases);

  const sections: SectionConfig[] = useMemo(() => {
    const all: SectionConfig[] = [
      {
        key: 'tags',
        label: 'Tags',
        icon: SwatchBookIcon,
        color: 'emerald',
        count: filterCount.tags,
        mode: visibility.tags,
        available: filterCount.tags > 0,
        emptyCategory: 'tag',
      },
      {
        key: 'nameSearch',
        label: 'Name search',
        icon: FileSearchIcon,
        color: 'slate',
        count: filterCount.filenamePatterns,
        mode: visibility.nameSearch,
        available: filterCount.filenamePatterns > 0,
        emptyCategory: 'name search',
      },
      {
        key: 'sizes',
        label: 'Sizes',
        icon: ImageIcon,
        color: 'sky',
        count: filterCount.sizes,
        mode: visibility.sizes,
        available: filterCount.sizes > 0,
        emptyCategory: 'size',
      },
      {
        key: 'buckets',
        label: 'Buckets',
        icon: ArchiveIcon,
        color: 'slate',
        count: filterCount.buckets,
        mode: visibility.buckets,
        available: filterCount.buckets > 0,
        emptyCategory: 'bucket',
      },
      {
        key: 'extensions',
        label: 'Extensions',
        icon: FileImageIcon,
        color: 'stone',
        count: filterCount.extensions,
        mode: visibility.extensions,
        available: filterCount.extensions > 0,
        emptyCategory: 'file type',
      },
      {
        key: 'subfolders',
        label: 'Subfolders',
        icon: FolderOpenIcon,
        color: 'indigo',
        count: filterCount.subfolders,
        mode: visibility.subfolders,
        available: filterCount.subfolders > 0,
        emptyCategory: 'subfolder',
      },
      {
        key: 'triggerPhrases',
        label: 'Trigger phrases',
        icon: HighlighterIcon,
        color: 'green',
        count: triggerPhrases.length,
        mode: visibility.triggerPhrases,
        available: triggerPhrases.length > 0,
        emptyCategory: 'trigger phrase',
      },
    ];
    return all;
  }, [filterCount, visibility, triggerPhrases]);

  const handleSetClassMode = useCallback(
    (classKey: VisibilityClassKey, mode: ClassFilterMode) => {
      dispatch(setVisibilityClassMode({ classKey, mode }));
    },
    [dispatch],
  );

  const handleToggleScopeTagless = useCallback(
    () => dispatch(toggleVisibilityScopeTagless()),
    [dispatch],
  );

  const handleToggleScopeSelected = useCallback(
    () => dispatch(toggleVisibilityScopeSelected()),
    [dispatch],
  );

  const handleToggleModified = useCallback(
    () => dispatch(toggleVisibilityModified()),
    [dispatch],
  );

  // Count how many classes/scopes are actively filtering
  // A class only counts if it has both a non-OFF mode AND selections to filter with
  const activeCount = useMemo(() => {
    let count = 0;
    for (const section of sections) {
      if (section.mode !== ClassFilterMode.OFF && section.count > 0) count++;
    }
    if (visibility.scopeTagless) count++;
    if (visibility.scopeSelected) count++;
    if (visibility.showModified) count++;
    return count;
  }, [
    sections,
    visibility.scopeTagless,
    visibility.scopeSelected,
    visibility.showModified,
  ]);

  return {
    sections,
    visibility,
    activeCount,
    selectedAssetsCount,
    hasTaglessAssets,
    hasModifiedAssets,
    handleSetClassMode,
    handleToggleScopeTagless,
    handleToggleScopeSelected,
    handleToggleModified,
  };
};
