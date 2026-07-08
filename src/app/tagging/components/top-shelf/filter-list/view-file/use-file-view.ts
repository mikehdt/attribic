import { useCallback, useEffect, useMemo, useState } from 'react';

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

import { useFilterContext } from '../filter-context';
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
    updateListLength,
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
      // If sort type is active, compare by active state first
      if (sortType === 'active') {
        // First compare by active state
        if (a.isActive !== b.isActive) {
          // Default (desc) puts active items first, asc puts them last
          return sortDirection === 'desc'
            ? a.isActive
              ? -1
              : 1 // active items first when descending (default)
            : a.isActive
              ? 1
              : -1; // active items last when ascending
        }
        // If both have same active state, sort by count descending (9-0) as secondary criteria
        return b.count - a.count; // always descending count (9-0) as tie-breaker
      }
      // If sort type is count, compare by count
      else if (sortType === 'count') {
        return sortDirection === 'asc'
          ? a.count - b.count // ascending
          : b.count - a.count; // descending
      }
      // Otherwise sort by extension name (alphabetical)
      else {
        return sortDirection === 'asc'
          ? a.ext.localeCompare(b.ext) // A-Z
          : b.ext.localeCompare(a.ext); // Z-A
      }
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
      if (sortType === 'active') {
        if (a.isActive !== b.isActive) {
          return sortDirection === 'desc'
            ? a.isActive
              ? -1
              : 1
            : a.isActive
              ? 1
              : -1;
        }
        return b.count - a.count;
      } else if (sortType === 'count') {
        return sortDirection === 'asc' ? a.count - b.count : b.count - a.count;
      } else {
        return sortDirection === 'asc'
          ? a.subfolder.localeCompare(b.subfolder)
          : b.subfolder.localeCompare(a.subfolder);
      }
    });
  }, [allSubfolders, activeSubfolders, sortType, sortDirection]);

  // Update list length for keyboard navigation (subfolders + extensions as one continuous list)
  const combinedListLength = subfolderList.length + extensionList.length;
  useEffect(() => {
    updateListLength(combinedListLength);
  }, [combinedListLength, updateListLength]);

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

  // Scroll selected item into view
  useEffect(() => {
    const selected = getSelectedItem(selectedIndex);
    if (!selected) return;

    const elId =
      selected.type === 'subfolder'
        ? `subfolder-${selected.item.subfolder}`
        : `ext-${selected.item.ext}`;
    const el = document.getElementById(elId);
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex, getSelectedItem]);

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
