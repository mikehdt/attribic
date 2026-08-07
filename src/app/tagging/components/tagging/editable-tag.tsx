/**
 * EditableTag Component
 *
 * Wraps Tag and InputTag to provide inline editing capability.
 * This component separates the editing concern from drag-and-drop,
 * allowing editing to work regardless of whether DnD is enabled.
 */
import { memo } from 'react';

import { TagEditMode } from '@/app/store/preferences';

import { InputTag } from './input-tag';
import { Tag } from './tag';

type EditableTagProps = {
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
  onEditSelect: (tag: string) => void;
  isDuplicateEdit: boolean;
  suggestionsExclude: string[];
};

const EditableTagComponent = ({
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
  onEditSelect,
  isDuplicateEdit,
  suggestionsExclude,
}: EditableTagProps) => {
  if (isEditing) {
    return (
      <InputTag
        mode="edit"
        value={editValue}
        onChange={onEditChange}
        onSubmit={onEditSubmit}
        onCancel={onEditCancel}
        placeholder="Edit tag..."
        isDuplicate={isDuplicateEdit}
        suggestionsExclude={suggestionsExclude}
        onSuggestionSelect={onEditSelect}
      />
    );
  }

  return (
    <Tag
      tagName={tagName}
      tagState={tagState}
      count={count}
      isHighlighted={isHighlighted}
      isTriggerMatch={isTriggerMatch}
      fade={fade}
      isMatchingDuplicate={isMatchingDuplicate}
      tagEditMode={tagEditMode}
      onToggle={onToggle}
      onEdit={onEdit}
      onDelete={onDelete}
    />
  );
};

// Memo comparison - re-render when editing state or visual props change
const editableTagPropsAreEqual = (
  prevProps: EditableTagProps,
  nextProps: EditableTagProps,
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
    prevProps.onEditCancel === nextProps.onEditCancel &&
    prevProps.onEditSelect === nextProps.onEditSelect &&
    prevProps.suggestionsExclude === nextProps.suggestionsExclude
  );
};

export const EditableTag = memo(EditableTagComponent, editableTagPropsAreEqual);
