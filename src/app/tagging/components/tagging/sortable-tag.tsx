/**
 * SortableTag Component v2
 *
 * Wraps EditableTag with drag-and-drop capability using useSortable.
 * The editing UI is handled by EditableTag, keeping concerns separated.
 */
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { memo } from 'react';

import { TagEditMode } from '@/app/store/preferences';

import { EditableTag } from './editable-tag';

type SortableTagProps = {
  id: string;
  tagName: string;
  tagState: number;
  count: number;
  isHighlighted: boolean;
  isTriggerMatch: boolean;
  fade: boolean;
  isMatchingDuplicate?: boolean;
  tagEditMode: TagEditMode;
  isEditing: boolean;
  editValue: string;
  onToggle: (tagName: string) => void;
  onEdit: (tagName: string) => void;
  onDelete: (tagName: string) => void;
  onEditChange: (value: string) => void;
  onEditSubmit: () => void;
  onEditCancel: () => void;
  isDuplicateEdit: boolean;
};

const SortableTagComponent = ({
  id,
  tagName,
  tagState,
  count,
  isHighlighted,
  isTriggerMatch,
  fade,
  isMatchingDuplicate,
  tagEditMode,
  isEditing,
  editValue,
  onToggle,
  onEdit,
  onDelete,
  onEditChange,
  onEditSubmit,
  onEditCancel,
  isDuplicateEdit,
}: SortableTagProps) => {
  // Disable drag while editing, faded, or when shown as matching duplicate
  const isDragDisabled = isEditing || fade || isMatchingDuplicate;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    disabled: isDragDisabled,
    // The list order itself changes during a drag (no sorting strategy), so
    // FLIP-animate items to their new flow positions when their index changes
    animateLayoutChanges: () => true,
    transition: {
      duration: 200,
      easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
    },
  });

  // While dragging, the pointer-following visual is the DragOverlay; this
  // in-list element stays in flow as a translucent placeholder that reserves
  // the drop space at the tag's natural width
  const style = {
    transform: isDragging ? undefined : CSS.Translate.toString(transform),
    transition: isDragging ? undefined : transition,
    opacity: isDragging ? 0.35 : 1,
    touchAction: 'none' as const,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(isDragDisabled ? {} : attributes)}
      {...(isDragDisabled ? {} : listeners)}
      className={`mr-2 mb-2 ${isDragDisabled ? '' : 'cursor-grab active:cursor-grabbing'}`}
    >
      <EditableTag
        tagName={tagName}
        tagState={tagState}
        count={count}
        isHighlighted={isHighlighted}
        isTriggerMatch={isTriggerMatch}
        fade={fade}
        isMatchingDuplicate={isMatchingDuplicate}
        tagEditMode={tagEditMode}
        isEditing={isEditing}
        editValue={editValue}
        onToggle={onToggle}
        onEdit={onEdit}
        onDelete={onDelete}
        onEditChange={onEditChange}
        onEditSubmit={onEditSubmit}
        onEditCancel={onEditCancel}
        isDuplicateEdit={isDuplicateEdit}
      />
    </div>
  );
};

// Memo comparison - skip re-render if props unchanged
const sortableTagPropsAreEqual = (
  prevProps: SortableTagProps,
  nextProps: SortableTagProps,
): boolean => {
  // If editing state changes, must re-render
  if (prevProps.isEditing !== nextProps.isEditing) {
    return false;
  }

  // During edit mode, check edit-specific props
  if (nextProps.isEditing) {
    if (
      prevProps.editValue !== nextProps.editValue ||
      prevProps.isDuplicateEdit !== nextProps.isDuplicateEdit
    ) {
      return false;
    }
  }

  // Check all visual/interaction props
  return (
    prevProps.id === nextProps.id &&
    prevProps.tagName === nextProps.tagName &&
    prevProps.tagState === nextProps.tagState &&
    prevProps.count === nextProps.count &&
    prevProps.isHighlighted === nextProps.isHighlighted &&
    prevProps.isTriggerMatch === nextProps.isTriggerMatch &&
    prevProps.fade === nextProps.fade &&
    prevProps.isMatchingDuplicate === nextProps.isMatchingDuplicate &&
    prevProps.tagEditMode === nextProps.tagEditMode &&
    prevProps.onToggle === nextProps.onToggle &&
    prevProps.onEdit === nextProps.onEdit &&
    prevProps.onDelete === nextProps.onDelete &&
    prevProps.onEditChange === nextProps.onEditChange &&
    prevProps.onEditSubmit === nextProps.onEditSubmit &&
    prevProps.onEditCancel === nextProps.onEditCancel
  );
};

export const SortableTag = memo(SortableTagComponent, sortableTagPropsAreEqual);
