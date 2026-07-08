/**
 * TaggingManager v2
 *
 * Phase 5: DndContext moved inside TagList memo boundary
 * - DndContext is now inside TagsDisplay (after memo check)
 * - Memo blocks re-renders of entire DnD subtree when tags unchanged
 * - Supports add, toggle, edit, delete, and reorder
 */
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { memo, useCallback, useMemo } from 'react';

import {
  addTag,
  deleteTag,
  editTag,
  reorderTags,
  selectAssetHighlightedTags,
  selectOrderedTagsWithStatus,
  selectTagCounts,
} from '@/app/store/assets';
import { toggleTagFilter } from '@/app/store/filters';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import { selectTagEditMode } from '@/app/store/preferences';
import {
  selectCaptionMode,
  selectTagSortType,
  selectTriggerPhrases,
  TagSortType,
} from '@/app/store/project';

import { TagList } from './tag-list';

type TaggingManagerProps = {
  assetId: string;
};

const TaggingManagerComponent = ({ assetId }: TaggingManagerProps) => {
  const dispatch = useAppDispatch();

  // Get tag data from Redux
  const orderedTagsWithStatus = useAppSelector((state) =>
    selectOrderedTagsWithStatus(state, assetId),
  );
  // Use global tag counts cache - one shared object for all assets
  const tagCounts = useAppSelector(selectTagCounts);
  // Use asset-specific highlighted tags selector - only re-renders when THIS asset's
  // highlighted tags change, not when unrelated filter tags change
  const highlightedTags = useAppSelector((state) =>
    selectAssetHighlightedTags(state, assetId),
  );
  // Only enable drag-and-drop when in "Sort Order" mode
  const tagSortType = useAppSelector(selectTagSortType);
  const isSortable = tagSortType === TagSortType.SORTABLE;
  const tagEditMode = useAppSelector(selectTagEditMode);
  const triggerPhrases = useAppSelector(selectTriggerPhrases);
  const captionMode = useAppSelector(selectCaptionMode);

  // Transform to the shape TagList expects - memoized to maintain reference stability
  const tags = useMemo(() => {
    const hasTriggers = triggerPhrases.length > 0;
    const triggerSet = hasTriggers
      ? new Set(triggerPhrases.map((p) => p.toLowerCase()))
      : null;

    return orderedTagsWithStatus.map(
      (tag: { name: string; status: number }) => ({
        name: tag.name,
        state: tag.status,
        count: tagCounts[tag.name] || 0,
        isHighlighted: highlightedTags.has(tag.name),
        isTriggerMatch: hasTriggers
          ? captionMode === 'sentences'
            ? triggerPhrases.some((p) =>
                tag.name.toLowerCase().includes(p.toLowerCase()),
              )
            : triggerSet!.has(tag.name.toLowerCase())
          : false,
      }),
    );
  }, [
    orderedTagsWithStatus,
    tagCounts,
    highlightedTags,
    triggerPhrases,
    captionMode,
  ]);

  // DnD sensors - stable across renders
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Handle reorder - TagList resolves the final indices from the drag interaction
  const handleReorder = useCallback(
    (oldIndex: number, newIndex: number) => {
      dispatch(reorderTags({ assetId, oldIndex, newIndex }));
    },
    [dispatch, assetId],
  );

  // Handle adding a new tag
  const handleAddTag = useCallback(
    (tagName: string, prepend?: boolean) => {
      dispatch(
        addTag({ assetId, tagName, position: prepend ? 'start' : 'end' }),
      );
    },
    [dispatch, assetId],
  );

  // Handle toggling a tag (adds/removes from filter)
  const handleToggleTag = useCallback(
    (tagName: string) => {
      dispatch(toggleTagFilter(tagName));
    },
    [dispatch],
  );

  // Handle editing a tag (rename)
  const handleEditTag = useCallback(
    (oldTagName: string, newTagName: string) => {
      dispatch(editTag({ assetId, oldTagName, newTagName }));
    },
    [dispatch, assetId],
  );

  // Handle deleting a tag (marks for deletion)
  const handleDeleteTag = useCallback(
    (tagName: string) => {
      dispatch(deleteTag({ assetId, tagName }));
    },
    [dispatch, assetId],
  );

  return (
    <TagList
      tags={tags}
      sortable={isSortable}
      tagEditMode={tagEditMode}
      assetId={assetId}
      sensors={sensors}
      onReorder={handleReorder}
      onAddTag={handleAddTag}
      onToggleTag={handleToggleTag}
      onEditTag={handleEditTag}
      onDeleteTag={handleDeleteTag}
    />
  );
};

export const TaggingManager = memo(TaggingManagerComponent);
