/**
 * Inner component that renders tags with DnD context inside memo boundary
 *
 * Phase 5: DndContext moved inside memo boundary
 * - DndContext and SortableContext are now inside TagsDisplay
 * - Memo blocks re-renders of entire DnD subtree when tags unchanged
 */
import { DndContext, DragOverlay } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import { memo } from 'react';

import { TagEditMode } from '@/app/store/preferences';

import { EditableTag } from '../editable-tag';
import { SortableTag } from '../sortable-tag';
import { Tag } from '../tag';
import { TagData } from './types';
import {
  collisionWithEdgeZones,
  measuringConfig,
  noSortingStrategy,
  useTagDrag,
} from './use-tag-drag';

const noop = () => {};

type TagsDisplayProps = {
  tags: TagData[];
  sortable: boolean;
  tagEditMode: TagEditMode;
  assetId: string;
  // DnD props
  sensors: ReturnType<typeof import('@dnd-kit/core').useSensors>;
  onReorder: (oldIndex: number, newIndex: number) => void;
  // Edit state
  editingTagName: string | null;
  editValue: string;
  isDuplicateEdit: boolean;
  // Duplicate match state (for fading non-matching tags)
  matchingTagName: string | null;
  // Autocomplete: tags hidden from rename suggestions (the asset's own tags)
  suggestionsExclude: string[];
  // Handlers
  onToggleTag: (tagName: string) => void;
  onEditTag: (tagName: string) => void;
  onDeleteTag: (tagName: string) => void;
  onEditChange: (value: string) => void;
  onEditSubmit: () => void;
  onEditCancel: () => void;
  onEditSelect: (tag: string) => void;
};

const TagsDisplayComponent = ({
  tags,
  sortable,
  tagEditMode,
  assetId,
  sensors,
  onReorder,
  editingTagName,
  editValue,
  isDuplicateEdit,
  matchingTagName,
  suggestionsExclude,
  onToggleTag,
  onEditTag,
  onDeleteTag,
  onEditChange,
  onEditSubmit,
  onEditCancel,
  onEditSelect,
}: TagsDisplayProps) => {
  const {
    displayedTags,
    displayedNames,
    activeTag,
    handleDragStart,
    handleDragUpdate,
    handleDragEnd,
    handleDragCancel,
  } = useTagDrag({ tags, onReorder });

  // Fade logic: when editing or when add input matches an existing tag,
  // fade all tags except the one being edited and the one that matches
  const isInputActive = editingTagName !== null || matchingTagName !== null;

  const tagElements = displayedTags.map((tag) => {
    const isBeingEdited = editingTagName === tag.name;
    const isMatchingTag = matchingTagName === tag.name;
    const fade = isInputActive && !isBeingEdited && !isMatchingTag;

    // Only pass edit-specific values to the tag being edited — all other tags
    // receive stable constants so their memo comparisons pass during keystrokes
    const tagEditValue = isBeingEdited ? editValue : '';
    const tagIsDuplicateEdit = isBeingEdited ? isDuplicateEdit : false;

    return sortable ? (
      <SortableTag
        key={tag.name}
        id={tag.name}
        tagName={tag.name}
        tagState={tag.state}
        count={tag.count}
        isHighlighted={tag.isHighlighted}
        isTriggerMatch={tag.isTriggerMatch}
        fade={fade}
        isMatchingDuplicate={isMatchingTag}
        tagEditMode={tagEditMode}
        isEditing={isBeingEdited}
        editValue={tagEditValue}
        onToggle={onToggleTag}
        onEdit={onEditTag}
        onDelete={onDeleteTag}
        onEditChange={onEditChange}
        onEditSubmit={onEditSubmit}
        onEditCancel={onEditCancel}
        onEditSelect={onEditSelect}
        isDuplicateEdit={tagIsDuplicateEdit}
        suggestionsExclude={suggestionsExclude}
      />
    ) : (
      <div key={tag.name} className="mr-2 mb-2">
        <EditableTag
          tagName={tag.name}
          tagState={tag.state}
          count={tag.count}
          isHighlighted={tag.isHighlighted}
          isTriggerMatch={tag.isTriggerMatch}
          fade={fade}
          isMatchingDuplicate={isMatchingTag}
          tagEditMode={tagEditMode}
          isEditing={isBeingEdited}
          editValue={tagEditValue}
          onToggle={onToggleTag}
          onEdit={onEditTag}
          onDelete={onDeleteTag}
          onEditChange={onEditChange}
          onEditSubmit={onEditSubmit}
          onEditCancel={onEditCancel}
          onEditSelect={onEditSelect}
          isDuplicateEdit={tagIsDuplicateEdit}
          suggestionsExclude={suggestionsExclude}
        />
      </div>
    );
  });

  // In sortable mode the DnD tree renders unconditionally. It used to mount
  // only on hover (to skip idle dnd-kit overhead), but that swapped the whole
  // element tree at every hover boundary — remounting all chip DOM, dropping
  // focus — and left the KeyboardSensor unreachable since keyboard users never
  // hover. Idle cost is just droppable registration; measuring and collision
  // work only happen during a drag. Non-draggable chips (editing, faded,
  // duplicate-matched) are disabled per-chip inside SortableTag.
  return (
    <div className="flex flex-wrap">
      {sortable ? (
        <DndContext
          sensors={sensors}
          collisionDetection={collisionWithEdgeZones}
          measuring={measuringConfig}
          onDragStart={handleDragStart}
          onDragMove={handleDragUpdate}
          onDragOver={handleDragUpdate}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext
            items={displayedNames}
            strategy={noSortingStrategy}
            id={`taglist-${assetId}`}
          >
            {tagElements}
          </SortableContext>
          <DragOverlay>
            {activeTag ? (
              <div className="cursor-grabbing">
                <Tag
                  tagName={activeTag.name}
                  tagState={activeTag.state}
                  count={activeTag.count}
                  isHighlighted={activeTag.isHighlighted}
                  isTriggerMatch={activeTag.isTriggerMatch}
                  fade={false}
                  tagEditMode={tagEditMode}
                  onToggle={noop}
                  onEdit={noop}
                  onDelete={noop}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : (
        tagElements
      )}
    </div>
  );
};

// Memo comparison - skip re-render only when NOT editing and no matching tag
const tagsDisplayPropsAreEqual = (
  prevProps: TagsDisplayProps,
  nextProps: TagsDisplayProps,
): boolean => {
  // If either state is editing, don't memo (need to update for keystroke/fade changes)
  if (prevProps.editingTagName !== null || nextProps.editingTagName !== null) {
    // But if editing the same tag and only editValue changed, we still need to re-render
    // So just return false to always re-render during edit mode
    return false;
  }

  // If matchingTagName changes, need to re-render for fade effect
  if (prevProps.matchingTagName !== nextProps.matchingTagName) {
    return false;
  }

  // Check sortable mode and edit mode
  if (prevProps.sortable !== nextProps.sortable) {
    return false;
  }
  if (prevProps.tagEditMode !== nextProps.tagEditMode) {
    return false;
  }

  // Handler references should be stable from useCallback
  if (
    prevProps.onToggleTag !== nextProps.onToggleTag ||
    prevProps.onEditTag !== nextProps.onEditTag ||
    prevProps.onDeleteTag !== nextProps.onDeleteTag ||
    prevProps.onReorder !== nextProps.onReorder ||
    prevProps.onEditSelect !== nextProps.onEditSelect ||
    prevProps.suggestionsExclude !== nextProps.suggestionsExclude
  ) {
    return false;
  }

  // Quick length check
  if (prevProps.tags.length !== nextProps.tags.length) {
    return false;
  }

  // Deep comparison of tag data only
  const isEqual = prevProps.tags.every((prevTag, i) => {
    const nextTag = nextProps.tags[i];
    return (
      prevTag.name === nextTag.name &&
      prevTag.state === nextTag.state &&
      prevTag.count === nextTag.count &&
      prevTag.isHighlighted === nextTag.isHighlighted &&
      prevTag.isTriggerMatch === nextTag.isTriggerMatch
    );
  });

  return isEqual;
};

export const TagsDisplay = memo(TagsDisplayComponent, tagsDisplayPropsAreEqual);
