import { useCallback, useMemo, useState } from 'react';

import {
  selectAllExtensions,
  selectAllSubfolders,
  selectFilenamePatternCounts,
} from '@/app/store/assets';
import {
  addFilenamePattern,
  removeFilenamePattern,
  selectFilenamePatterns,
  selectFilterExtensions,
  selectFilterSubfolders,
} from '@/app/store/filters';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';

import { compareByActive, compareByCount, compareByName } from '../comparators';
import { useFilterContext } from '../filter-context';
import { useFilterListEffects } from '../hooks/use-filter-list-effects';
import { useRangeToggle } from '../use-range-toggle';

export const useFileView = () => {
  const dispatch = useAppDispatch();
  const allExtensions = useAppSelector(selectAllExtensions);
  const allSubfolders = useAppSelector(selectAllSubfolders);
  const activeExtensions = useAppSelector(selectFilterExtensions);
  const activeSubfolders = useAppSelector(selectFilterSubfolders);
  const filenamePatterns = useAppSelector(selectFilenamePatterns);
  const patternCounts = useAppSelector(selectFilenamePatternCounts);

  const [patternInput, setPatternInputRaw] = useState('');

  const {
    sortType,
    sortDirection,
    selectedIndex,
    setSelectedIndex,
    inputRef,
    handleKeyDown,
    handleItemMouseMove,
    resetKeyboardIndex,
    handleListMouseLeave,
  } = useFilterContext();

  // When the user edits the input text, pull focus back from list navigation
  // so Enter adds the pattern instead of toggling the highlighted list item.
  const setPatternInput = useCallback(
    (value: string) => {
      setPatternInputRaw(value);
      setSelectedIndex(-1);
      resetKeyboardIndex();
    },
    [setSelectedIndex, resetKeyboardIndex],
  );

  // Sort the filename patterns based on current sort settings
  const sortedPatterns = useMemo(() => {
    if (filenamePatterns.length === 0) return [];

    return [...filenamePatterns].sort((a, b) => {
      // For 'active' sort, patterns are always "active" so just sort by count
      if (sortType === 'active' || sortType === 'count') {
        const countA = patternCounts[a] || 0;
        const countB = patternCounts[b] || 0;
        return sortDirection === 'asc' ? countA - countB : countB - countA;
      }
      // Alphabetical
      return sortDirection === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
    });
  }, [filenamePatterns, patternCounts, sortType, sortDirection]);

  // Get extension data from store
  const extensionList = useMemo(() => {
    // Convert map to array
    const list = Object.entries(allExtensions).map(([ext, count]) => ({
      ext,
      count,
      isActive: activeExtensions.includes(ext),
    }));

    // Sort the extensions
    return list.sort((a, b) => {
      if (sortType === 'active') return compareByActive(a, b, sortDirection);
      if (sortType === 'count') return compareByCount(a, b, sortDirection);
      return compareByName(a.ext, b.ext, sortDirection);
    });
  }, [allExtensions, activeExtensions, sortType, sortDirection]);

  // Get subfolder data from store
  const subfolderList = useMemo(() => {
    // Convert map to array
    const list = Object.entries(allSubfolders).map(([subfolder, count]) => ({
      subfolder,
      count,
      isActive: activeSubfolders.includes(subfolder),
    }));

    // Sort the subfolders (same logic as extensions)
    return list.sort((a, b) => {
      if (sortType === 'active') return compareByActive(a, b, sortDirection);
      if (sortType === 'count') return compareByCount(a, b, sortDirection);
      return compareByName(a.subfolder, b.subfolder, sortDirection);
    });
  }, [allSubfolders, activeSubfolders, sortType, sortDirection]);

  // Subfolders + extensions are one continuous keyboard list.
  const combinedListLength = subfolderList.length + extensionList.length;

  // Shift-click / Shift+Return range selection. Subfolders and extensions are
  // one keyboard list but two filter classes, so each gets its own range group;
  // extensions are offset by the subfolder count to map the global keyboard
  // index. A range never spans the two sections (the anchor value won't resolve
  // in the other list, so it falls back to a plain toggle).
  const {
    handleItemAction: handleSubfolderAction,
    previewState: subfolderPreviewState,
  } = useRangeToggle({
    items: subfolderList,
    getValue: (item) => item.subfolder,
    getIsActive: (item) => item.isActive,
    classKey: 'filterSubfolders',
  });
  const {
    handleItemAction: handleExtensionAction,
    previewState: extensionPreviewState,
  } = useRangeToggle({
    items: extensionList,
    getValue: (item) => item.ext,
    getIsActive: (item) => item.isActive,
    classKey: 'filterExtensions',
    indexOffset: subfolderList.length,
  });

  const handleRemovePattern = useCallback(
    (pattern: string, e: React.MouseEvent) => {
      e.stopPropagation();
      dispatch(removeFilenamePattern(pattern));
    },
    [dispatch],
  );

  const handleAddPattern = useCallback(() => {
    if (patternInput.trim()) {
      dispatch(addFilenamePattern(patternInput.trim()));
      setPatternInput('');
    }
  }, [dispatch, patternInput, setPatternInput]);

  // Combined keyboard handler: pattern input behaviour + list navigation
  const handleCombinedKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Enter with text in the input adds a pattern (pattern-specific behaviour)
      if (e.key === 'Enter' && patternInput.trim() && selectedIndex < 0) {
        dispatch(addFilenamePattern(patternInput.trim()));
        setPatternInput('');
        e.preventDefault();
        return;
      }
      // Escape with text clears the input (pattern-specific behaviour)
      if (e.key === 'Escape' && patternInput.trim() && selectedIndex < 0) {
        setPatternInput('');
        e.preventDefault();
        return;
      }
      // Delegate to the shared keyboard navigation handler
      handleKeyDown(e);
    },
    [patternInput, selectedIndex, dispatch, handleKeyDown, setPatternInput],
  );

  // Resolve selectedIndex to the correct list item
  const getSelectedItem = useCallback(
    (index: number) => {
      if (index < 0) return null;
      if (index < subfolderList.length) {
        return { type: 'subfolder' as const, item: subfolderList[index] };
      }
      const extIndex = index - subfolderList.length;
      if (extIndex < extensionList.length) {
        return { type: 'extension' as const, item: extensionList[extIndex] };
      }
      return null;
    },
    [subfolderList, extensionList],
  );

  useFilterListEffects(
    combinedListLength,
    useCallback(
      (index: number) => {
        const selected = getSelectedItem(index);
        if (!selected) return null;
        // Subfolder ids are encoded to match view-file.tsx (names may have
        // spaces); extensions are always id-safe.
        return selected.type === 'subfolder'
          ? `subfolder-${encodeURIComponent(selected.item.subfolder)}`
          : `ext-${selected.item.ext}`;
      },
      [getSelectedItem],
    ),
  );

  // Mouse move for extensions needs to offset by subfolder count so the shared
  // (global) highlight index lands on the right row.
  const handleExtensionMouseMove = useCallback(
    (index: number) => handleItemMouseMove(index + subfolderList.length),
    [handleItemMouseMove, subfolderList.length],
  );

  return {
    inputRef,
    patternInput,
    setPatternInput,
    sortedPatterns,
    patternCounts,
    extensionList,
    subfolderList,
    subfolderListLength: subfolderList.length,
    selectedIndex,
    handleSubfolderAction,
    handleExtensionAction,
    subfolderPreviewState,
    extensionPreviewState,
    handleCombinedKeyDown,
    handleRemovePattern,
    handleAddPattern,
    handleItemMouseMove,
    handleExtensionMouseMove,
    handleListMouseLeave,
  };
};
