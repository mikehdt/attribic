/**
 * Add/edit input state, duplicate detection, double-click toggle timing and
 * clipboard copy for TagList. Edit state lives here (rather than in Tag) so it
 * stays close to where it's used and survives SortableTag↔EditableTag swaps.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useToast } from '@/app/shared/toast';
import { TagEditMode } from '@/app/store/preferences';

import { TagData } from './types';

type UseTagListParams = {
  tags: TagData[];
  tagEditMode: TagEditMode;
  onAddTag: (tagName: string, prepend?: boolean) => void;
  onToggleTag: (tagName: string) => void;
  onEditTag: (oldName: string, newName: string) => void;
};

export const useTagList = ({
  tags,
  tagEditMode,
  onAddTag,
  onToggleTag,
  onEditTag,
}: UseTagListParams) => {
  const { showToast } = useToast();

  // Ref for current tags — lets handleMultipleTagsSubmit read the latest tags
  // without depending on the tags array reference (which would destabilise the callback)
  const tagsRef = useRef(tags);
  useEffect(() => {
    tagsRef.current = tags;
  });

  // Add new tag input state
  const [inputValue, setInputValue] = useState('');

  // Edit tag state
  const [editingTagName, setEditingTagName] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // Check if add input would be a duplicate
  const isDuplicateAdd = tags.some(
    (tag) => tag.name.toLowerCase() === inputValue.trim().toLowerCase(),
  );

  // Check if edit input would be a duplicate (excluding the tag being edited)
  const isDuplicateEdit =
    editValue.trim().toLowerCase() !== editingTagName?.toLowerCase() &&
    tags.some(
      (tag) => tag.name.toLowerCase() === editValue.trim().toLowerCase(),
    );

  // Refs for handleEditSubmit — reading these at submit time instead of as
  // useCallback deps keeps the callback stable during editing keystrokes
  const editValueRef = useRef(editValue);
  const isDuplicateEditRef = useRef(isDuplicateEdit);
  useEffect(() => {
    editValueRef.current = editValue;
    isDuplicateEditRef.current = isDuplicateEdit;
  });

  // Find the matching tag name for fading other tags
  // When adding: show which tag already exists with that name
  // When editing: show which tag conflicts with the new name
  const matchingTagName = useMemo(() => {
    const addInputTrimmed = inputValue.trim().toLowerCase();
    const editInputTrimmed = editValue.trim().toLowerCase();

    // Check add input first (if there's content and it matches)
    if (addInputTrimmed) {
      const matchingTag = tags.find(
        (tag) => tag.name.toLowerCase() === addInputTrimmed,
      );
      if (matchingTag) return matchingTag.name;
    }

    // Check edit input (if editing and the new value conflicts with another tag)
    if (editingTagName && editInputTrimmed !== editingTagName.toLowerCase()) {
      const matchingTag = tags.find(
        (tag) => tag.name.toLowerCase() === editInputTrimmed,
      );
      if (matchingTag) return matchingTag.name;
    }

    return null;
  }, [tags, inputValue, editValue, editingTagName]);

  // Add input handlers
  const handleInputChange = setInputValue;

  const handleSubmit = useCallback(
    (prepend?: boolean) => {
      if (inputValue.trim() && !isDuplicateAdd) {
        onAddTag(inputValue.trim(), prepend);
        setInputValue('');
      }
    },
    [inputValue, isDuplicateAdd, onAddTag],
  );

  const handleCancel = useCallback(() => {
    setInputValue('');
  }, []);

  // Handle multiple tags from paste or comma-separated input
  const handleMultipleTagsSubmit = useCallback(
    (newTags: string[], prepend?: boolean) => {
      // Get existing tag names for duplicate checking (via ref for callback stability)
      const existingTagNames = new Set(
        tagsRef.current.map((t) => t.name.toLowerCase()),
      );

      // Filter out duplicates and add each unique tag
      const uniqueTags = newTags.filter(
        (tag) => !existingTagNames.has(tag.toLowerCase()),
      );

      // When prepending, reverse the order so they appear in the original order at the start
      const tagsToAdd = prepend ? [...uniqueTags].reverse() : uniqueTags;

      tagsToAdd.forEach((tag) => {
        onAddTag(tag, prepend);
      });

      setInputValue('');
    },
    [onAddTag],
  );

  // Edit handlers
  const handleStartEdit = useCallback((tagName: string) => {
    setEditingTagName(tagName);
    setEditValue(tagName);
  }, []);

  const handleEditChange = useCallback((value: string) => {
    setEditValue(value);
  }, []);

  const handleEditSubmit = useCallback(() => {
    if (!editingTagName) return;
    const currentEditValue = editValueRef.current.trim();
    // Duplicate: keep the edit open so the matching-tag highlight (and the
    // input's flash) can show why the submit was refused
    if (currentEditValue && isDuplicateEditRef.current) return;
    // Empty falls through without dispatching — submitting nothing is a cancel
    if (currentEditValue && currentEditValue !== editingTagName) {
      onEditTag(editingTagName, currentEditValue);
    }
    setEditingTagName(null);
    setEditValue('');
  }, [editingTagName, onEditTag]);

  const handleEditCancel = useCallback(() => {
    setEditingTagName(null);
    setEditValue('');
  }, []);

  // Double-click timing: in DOUBLE_CLICK mode, defer single-click toggles
  // so a rapid second click can cancel the toggle and trigger edit instead.
  // This lives here (not in Tag) so the timer survives SortableTag↔EditableTag swaps.
  const DOUBLE_CLICK_WINDOW = 200;
  const pendingToggleRef = useRef<{
    timer: ReturnType<typeof setTimeout>;
    tagName: string;
  } | null>(null);

  const handleToggleTag = useCallback(
    (tagName: string) => {
      if (tagEditMode === TagEditMode.DOUBLE_CLICK) {
        const pending = pendingToggleRef.current;
        if (pending !== null) {
          clearTimeout(pending.timer);
          pendingToggleRef.current = null;
          // A click on a different tag can't be the second half of a
          // double-click on the pending one — fire its toggle now rather
          // than dropping it
          if (pending.tagName !== tagName) {
            onToggleTag(pending.tagName);
          }
        }
        pendingToggleRef.current = {
          tagName,
          timer: setTimeout(() => {
            pendingToggleRef.current = null;
            onToggleTag(tagName);
          }, DOUBLE_CLICK_WINDOW),
        };
      } else {
        onToggleTag(tagName);
      }
    },
    [onToggleTag, tagEditMode],
  );

  // When edit starts (via double-click), cancel the pending toggle for that tag
  const handleStartEditWithCancel = useCallback(
    (tagName: string) => {
      if (
        pendingToggleRef.current !== null &&
        pendingToggleRef.current.tagName === tagName
      ) {
        clearTimeout(pendingToggleRef.current.timer);
        pendingToggleRef.current = null;
      }
      handleStartEdit(tagName);
    },
    [handleStartEdit],
  );

  // Determine which tags to copy and whether it's a partial copy
  const copyInfo = useMemo(() => {
    // Get highlighted tags (those matching filter) that are in this asset
    const highlightedTagsInAsset = tags
      .filter((tag) => tag.isHighlighted)
      .map((tag) => tag.name);

    // If we have highlighted tags, copy only those; otherwise copy all
    const shouldCopySelection = highlightedTagsInAsset.length > 0;
    const tagsToCopy = shouldCopySelection
      ? highlightedTagsInAsset
      : tags.map((tag) => tag.name);

    return {
      tagsToCopy,
      isPartialCopy: shouldCopySelection,
      selectedCount: highlightedTagsInAsset.length,
    };
  }, [tags]);

  const handleCopyTags = useCallback(async () => {
    const tagsText = copyInfo.tagsToCopy.join(', ');

    try {
      await navigator.clipboard.writeText(tagsText);

      if (copyInfo.isPartialCopy) {
        showToast(
          `Copied ${copyInfo.selectedCount} selected ${copyInfo.selectedCount === 1 ? 'tag' : 'tags'}`,
        );
      } else {
        showToast('Tags copied to clipboard');
      }
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      showToast('Failed to copy tags');
    }
  }, [copyInfo, showToast]);

  return {
    inputValue,
    editingTagName,
    editValue,
    isDuplicateAdd,
    isDuplicateEdit,
    matchingTagName,
    copyInfo,
    handleInputChange,
    handleSubmit,
    handleCancel,
    handleMultipleTagsSubmit,
    handleEditChange,
    handleEditSubmit,
    handleEditCancel,
    handleToggleTag,
    handleStartEditWithCancel,
    handleCopyTags,
  };
};
