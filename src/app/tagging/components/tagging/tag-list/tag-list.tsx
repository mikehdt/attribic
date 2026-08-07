/**
 * TagList Component v2
 *
 * Add/edit state and clipboard live in useTagList; the DnD subtree lives in
 * TagsDisplay so its memo boundary can block re-renders of the whole tree.
 */
import { ClipboardIcon, ClipboardListIcon } from 'lucide-react';
import { memo, useMemo } from 'react';

import { Button } from '@/app/shared/button';
import { TagEditMode } from '@/app/store/preferences';

import { InputTag } from '../input-tag';
import { TagsDisplay } from './tags-display';
import { TagData } from './types';
import { useTagList } from './use-tag-list';

type TagListProps = {
  tags: TagData[];
  sortable?: boolean;
  tagEditMode: TagEditMode;
  assetId: string;
  // DnD props - passed through to TagsDisplay
  sensors: ReturnType<typeof import('@dnd-kit/core').useSensors>;
  onReorder: (oldIndex: number, newIndex: number) => void;
  // Handlers
  onAddTag: (tagName: string, prepend?: boolean) => void;
  onToggleTag: (tagName: string) => void;
  onEditTag: (oldName: string, newName: string) => void;
  onDeleteTag: (tagName: string) => void;
};

const TagListComponent = ({
  tags,
  sortable = false,
  tagEditMode,
  assetId,
  sensors,
  onReorder,
  onAddTag,
  onToggleTag,
  onEditTag,
  onDeleteTag,
}: TagListProps) => {
  const {
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
    handleSuggestionAdd,
    handleEditChange,
    handleEditSubmit,
    handleEditCancel,
    handleEditSelect,
    handleToggleTag,
    handleStartEditWithCancel,
    handleCopyTags,
  } = useTagList({ tags, tagEditMode, onAddTag, onToggleTag, onEditTag });

  // Stable identity so InputTag/EditableTag memo comparisons hold during
  // keystrokes — suggestions matching these names are no-ops and hidden
  const tagNames = useMemo(() => tags.map((tag) => tag.name), [tags]);

  return (
    <div className="flex h-full w-full">
      <div className="flex flex-1 flex-col">
        <TagsDisplay
          tags={tags}
          sortable={sortable}
          tagEditMode={tagEditMode}
          assetId={assetId}
          sensors={sensors}
          onReorder={onReorder}
          editingTagName={editingTagName}
          editValue={editValue}
          isDuplicateEdit={isDuplicateEdit}
          matchingTagName={matchingTagName}
          suggestionsExclude={tagNames}
          onToggleTag={handleToggleTag}
          onEditTag={handleStartEditWithCancel}
          onDeleteTag={onDeleteTag}
          onEditChange={handleEditChange}
          onEditSubmit={handleEditSubmit}
          onEditCancel={handleEditCancel}
          onEditSelect={handleEditSelect}
        />

        <div className="mt-2">
          <InputTag
            mode="add"
            value={inputValue}
            onChange={handleInputChange}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            placeholder="Add tag..."
            isDuplicate={isDuplicateAdd}
            disabled={editingTagName !== null}
            onMultipleTagsSubmit={handleMultipleTagsSubmit}
            suggestionsExclude={tagNames}
            onSuggestionSelect={handleSuggestionAdd}
          />
        </div>
      </div>

      {tags.length > 0 && (
        <div className="self-end">
          <Button
            onClick={handleCopyTags}
            variant="ghost"
            size="xs"
            color={copyInfo.isPartialCopy ? 'teal' : 'slate'}
            title={
              copyInfo.isPartialCopy
                ? `Copy ${copyInfo.selectedCount} selected ${copyInfo.selectedCount === 1 ? 'tag' : 'tags'} as comma-separated list`
                : 'Copy all tags as comma-separated list'
            }
          >
            {copyInfo.isPartialCopy ? (
              <ClipboardListIcon className="h-4 w-4 opacity-50" />
            ) : (
              <ClipboardIcon className="h-4 w-4 opacity-50" />
            )}
          </Button>
        </div>
      )}
    </div>
  );
};

const tagListPropsAreEqual = (
  prevProps: TagListProps,
  nextProps: TagListProps,
): boolean => {
  // Check sortable mode, edit mode, and assetId
  if (
    prevProps.sortable !== nextProps.sortable ||
    prevProps.tagEditMode !== nextProps.tagEditMode ||
    prevProps.assetId !== nextProps.assetId
  ) {
    return false;
  }

  // Check DnD callback references (sensors is stable from useSensors)
  if (
    prevProps.sensors !== nextProps.sensors ||
    prevProps.onReorder !== nextProps.onReorder
  ) {
    return false;
  }

  // Check callback references
  if (
    prevProps.onAddTag !== nextProps.onAddTag ||
    prevProps.onToggleTag !== nextProps.onToggleTag ||
    prevProps.onEditTag !== nextProps.onEditTag ||
    prevProps.onDeleteTag !== nextProps.onDeleteTag
  ) {
    return false;
  }

  // Check tags array
  if (prevProps.tags.length !== nextProps.tags.length) {
    return false;
  }

  return prevProps.tags.every((prevTag, i) => {
    const nextTag = nextProps.tags[i];
    return (
      prevTag.name === nextTag.name &&
      prevTag.state === nextTag.state &&
      prevTag.count === nextTag.count &&
      prevTag.isHighlighted === nextTag.isHighlighted &&
      prevTag.isTriggerMatch === nextTag.isTriggerMatch
    );
  });
};

export const TagList = memo(TagListComponent, tagListPropsAreEqual);
