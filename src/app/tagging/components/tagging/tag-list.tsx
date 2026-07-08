/**
 * TagList Component v2
 *
 * Phase 5: DndContext moved inside memo boundary
 * - DndContext and SortableContext are now inside TagsDisplay
 * - Memo blocks re-renders of entire DnD subtree when tags unchanged
 * - Edit state managed here to keep it close to where it's used
 *
 * Drag reordering (variable-width aware):
 * - No sorting strategy — tags have uneven widths, so transform-based
 *   strategies (rectSortingStrategy) misplace them. Instead the list order
 *   itself is updated during onDragOver and flex-wrap reflows naturally,
 *   including tags wrapping between rows.
 * - The dragged tag stays in the list as a translucent placeholder (the
 *   reserved drop space at its natural width); the floating visual is a
 *   DragOverlay that settles into the gap on drop.
 * - Position changes animate via FLIP in SortableTag (animateLayoutChanges).
 */
import {
  ClientRect,
  CollisionDetection,
  DndContext,
  DragMoveEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  getClientRect,
  MeasuringStrategy,
  pointerWithin,
  UniqueIdentifier,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  SortingStrategy,
} from '@dnd-kit/sortable';
import { ClipboardIcon, ClipboardListIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/app/shared/button';
import { useToast } from '@/app/shared/toast';
import { TagEditMode } from '@/app/store/preferences';

import { EditableTag } from './editable-tag';
import { InputTag } from './input-tag';
import { SortableTag } from './sortable-tag';
import { Tag } from './tag';

// Layout comes from real DOM reflow (flex-wrap), not transforms
const noSortingStrategy: SortingStrategy = () => null;

// Re-measure drop targets during drag — reflow moves them as the order changes.
// Measure settled layout positions (ignoreTransform): during the FLIP shuffle
// animation, chips are transformed back toward their OLD spots, and measuring
// those in-flight rects makes collision detection see the pre-swap layout and
// swap back — an infinite reorder loop.
const measuringConfig = {
  droppable: {
    strategy: MeasuringStrategy.Always,
    measure: (element: HTMLElement) =>
      getClientRect(element, { ignoreTransform: true }),
  },
};

const noop = () => {};

// Pointer context written by collisionWithEdgeZones and read by the drag
// handlers. dnd-kit events don't expose current pointer coordinates
// (activatorEvent + delta drifts), but the collision detector receives them
// exactly — so both the edge-zone decision and the raw coordinates are
// captured there. Module-level is safe: only one drag (one pointer) can be
// active at a time across all lists.
let pointerEdgeZone: 'start' | 'end' | null = null;
let dragPointer: { x: number; y: number } | null = null;

// pointerWithin only hits actual chips, so the empty regions before the first
// chip and after the last chip are dead zones — dragging there should mean
// "move to the start/end". When no chip is hit, find the flow-first and
// flow-last chips and, if the pointer is past either, report that chip as the
// target and record which zone fired; handleDragUpdate turns it into a
// start/end placement.
const collisionWithEdgeZones: CollisionDetection = (args) => {
  pointerEdgeZone = null;
  dragPointer = args.pointerCoordinates;
  const within = pointerWithin(args);
  if (within.length > 0) return within;

  const { pointerCoordinates, droppableRects, droppableContainers } = args;
  if (!pointerCoordinates) return [];

  let firstId: UniqueIdentifier | null = null;
  let firstRect: ClientRect | null = null;
  let lastId: UniqueIdentifier | null = null;
  let lastRect: ClientRect | null = null;
  for (const container of droppableContainers) {
    const rect = droppableRects.get(container.id);
    if (!rect) continue;
    const higherRow = firstRect === null || rect.top < firstRect.top - 1;
    const earlierInRow =
      firstRect !== null &&
      Math.abs(rect.top - firstRect.top) <= 1 &&
      rect.left < firstRect.left;
    if (higherRow || earlierInRow) {
      firstId = container.id;
      firstRect = rect;
    }
    const lowerRow = lastRect === null || rect.top > lastRect.top + 1;
    const laterInRow =
      lastRect !== null &&
      Math.abs(rect.top - lastRect.top) <= 1 &&
      rect.left > lastRect.left;
    if (lowerRow || laterInRow) {
      lastId = container.id;
      lastRect = rect;
    }
  }
  if (firstId === null || firstRect === null || !lastId || !lastRect) {
    return [];
  }

  const { x, y } = pointerCoordinates;
  const aboveAllRows = y < firstRect.top;
  const beforeStartOfFirstRow =
    y >= firstRect.top && y <= firstRect.bottom && x < firstRect.left;
  if (aboveAllRows || beforeStartOfFirstRow) {
    pointerEdgeZone = 'start';
    return [{ id: firstId }];
  }

  const belowAllRows = y > lastRect.bottom;
  const pastEndOfLastRow =
    y >= lastRect.top && y <= lastRect.bottom && x > lastRect.right;
  if (belowAllRows || pastEndOfLastRow) {
    pointerEdgeZone = 'end';
    return [{ id: lastId }];
  }
  return [];
};

type TagData = {
  name: string;
  state: number;
  count: number;
  isHighlighted: boolean;
  isTriggerMatch: boolean;
};

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

/**
 * Inner component that renders tags with DnD context inside memo boundary
 * DndContext is inside here so memo can block re-renders of entire DnD subtree
 */
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
  // Handlers
  onToggleTag: (tagName: string) => void;
  onEditTag: (tagName: string) => void;
  onDeleteTag: (tagName: string) => void;
  onEditChange: (value: string) => void;
  onEditSubmit: () => void;
  onEditCancel: () => void;
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
  onToggleTag,
  onEditTag,
  onDeleteTag,
  onEditChange,
  onEditSubmit,
  onEditCancel,
}: TagsDisplayProps) => {
  // Conditional DnD: only render DndContext when hovered or dragging
  const [isHovered, setIsHovered] = useState(false);
  const isDraggingRef = useRef(false);

  // Live drag state: dragOrder is the optimistically reordered tag names
  // while a drag is in flight (null otherwise). Reordering the actual list
  // lets flex-wrap lay tags out at their natural widths, rows and all.
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);

  // Placement intents ("<chipId>:<before|after>", "#zone:end") applied since
  // the pointer last moved. Each reflow re-fires collisions with the pointer
  // unchanged (MeasuringStrategy.Always), which is sometimes legitimate — a
  // reflow can reveal a new chip under a stationary pointer that still needs
  // placing (a settling cascade) — and sometimes a feedback cycle that would
  // reorder forever. The difference: a cascade applies distinct intents and
  // converges; a cycle revisits one. So while the pointer is stationary each
  // intent may apply at most once; any movement resets the slate.
  const stationaryIntentsRef = useRef<{
    pointer: { x: number; y: number } | null;
    applied: Set<string>;
  }>({ pointer: null, applied: new Set() });

  const handleMouseEnter = useCallback(() => setIsHovered(true), []);
  const handleMouseLeave = useCallback(() => {
    // Don't disable DnD if we're mid-drag
    if (!isDraggingRef.current) {
      setIsHovered(false);
    }
  }, []);

  const tagNames = useMemo(() => tags.map((t) => t.name), [tags]);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      isDraggingRef.current = true;
      stationaryIntentsRef.current.pointer = null;
      stationaryIntentsRef.current.applied.clear();
      pointerEdgeZone = null;
      setActiveId(event.active.id as string);
      setDragOrder(tagNames);
    },
    [tagNames],
  );

  // Handles both onDragOver and onDragMove. onDragOver only fires when the
  // target changes, which misses pointer moves into an edge zone while the
  // target id stays the same (e.g. from inside the first chip to above it) —
  // onDragMove fires continuously and covers those. Zone placements are
  // idempotent, so double-processing is harmless.
  const handleDragUpdate = useCallback(
    (event: DragMoveEvent | DragOverEvent) => {
      const { active, over } = event;
      const zone = pointerEdgeZone;
      const pointer = dragPointer;
      if (!pointer) return;

      // One application per intent while the pointer is stationary; any
      // movement resets the slate
      const station = stationaryIntentsRef.current;
      if (
        !station.pointer ||
        Math.abs(pointer.x - station.pointer.x) >= 1 ||
        Math.abs(pointer.y - station.pointer.y) >= 1
      ) {
        station.pointer = pointer;
        station.applied.clear();
      }

      // Edge zones: place at the very start/end
      if (zone) {
        const zoneIntent = `#zone:${zone}`;
        if (station.applied.has(zoneIntent)) return;
        setDragOrder((prev) => {
          if (!prev) return prev;
          const from = prev.indexOf(active.id as string);
          if (from === -1) return prev;
          const to = zone === 'start' ? 0 : prev.length - 1;
          if (to === from) return prev;
          station.applied.add(zoneIntent);
          return arrayMove(prev, from, to);
        });
        return;
      }

      if (!over || active.id === over.id) return;

      const overRect = over.rect;
      const activeRect = active.rect.current.initial;
      // Which side of the hovered chip's midpoint the pointer is on decides
      // placement: before or after that chip. The axis follows the flow — a
      // chip much taller than the target (a wrapped multi-line tag) can't sit
      // beside it, so it compares vertically (top half = take its spot,
      // bottom half = slot in below); same-height chips compare horizontally.
      // Pointing IS the position, so re-hovering a chip never toggles, and
      // the placement stays stable when a swapped chip's wider rect still
      // overlaps the pointer.
      const tallActive =
        activeRect !== null &&
        overRect.height > 0 &&
        activeRect.height > overRect.height * 1.5;
      const distFromMid = tallActive
        ? pointer.y - (overRect.top + overRect.height / 2)
        : pointer.x - (overRect.left + overRect.width / 2);
      // Dead-band: within a few px of the midpoint, keep the current
      // placement rather than flipping on hand tremor
      if (Math.abs(distFromMid) < 6) return;
      const after = distFromMid > 0;

      const intent = `${over.id}:${after ? 'after' : 'before'}`;
      if (station.applied.has(intent)) return;

      setDragOrder((prev) => {
        if (!prev) return prev;
        const from = prev.indexOf(active.id as string);
        const iOver = prev.indexOf(over.id as string);
        if (from === -1 || iOver === -1) return prev;
        let to = after ? iOver + 1 : iOver;
        if (from < to) to -= 1; // removing the active item shifts the target
        if (to === from) return prev;
        station.applied.add(intent);
        return arrayMove(prev, from, to);
      });
    },
    [],
  );

  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = false;
    if (activeId && dragOrder) {
      const oldIndex = tagNames.indexOf(activeId);
      const newIndex = dragOrder.indexOf(activeId);
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        onReorder(oldIndex, newIndex);
      }
    }
    setActiveId(null);
    setDragOrder(null);
  }, [activeId, dragOrder, tagNames, onReorder]);

  const handleDragCancel = useCallback(() => {
    isDraggingRef.current = false;
    setActiveId(null);
    setDragOrder(null);
  }, []);

  // Render order: the in-flight drag order when dragging, Redux order otherwise
  const displayedTags = useMemo(() => {
    if (!dragOrder) return tags;
    const byName = new Map(tags.map((t) => [t.name, t]));
    return dragOrder.flatMap((name) => byName.get(name) ?? []);
  }, [tags, dragOrder]);

  const displayedNames = useMemo(
    () => displayedTags.map((t) => t.name),
    [displayedTags],
  );

  const activeTag = useMemo(
    () => (activeId ? (tags.find((t) => t.name === activeId) ?? null) : null),
    [activeId, tags],
  );
  // Keep DnD enabled (which renders SortableTag with InputTag) when editing
  const dndEnabled = sortable && (isHovered || editingTagName !== null);

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

    return dndEnabled ? (
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
        isDuplicateEdit={tagIsDuplicateEdit}
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
          isDuplicateEdit={tagIsDuplicateEdit}
        />
      </div>
    );
  });

  // DndContext only rendered when hovered - eliminates dnd-kit overhead when not needed
  return (
    <div
      className="flex flex-wrap"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {dndEnabled ? (
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
    prevProps.onReorder !== nextProps.onReorder
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

const TagsDisplay = memo(TagsDisplayComponent, tagsDisplayPropsAreEqual);

/**
 * Main TagList component
 */
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
    const currentEditValue = editValueRef.current.trim();
    if (editingTagName && currentEditValue && !isDuplicateEditRef.current) {
      if (currentEditValue !== editingTagName) {
        onEditTag(editingTagName, currentEditValue);
      }
      setEditingTagName(null);
      setEditValue('');
    }
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
        if (pendingToggleRef.current !== null) {
          clearTimeout(pendingToggleRef.current.timer);
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
          onToggleTag={handleToggleTag}
          onEditTag={handleStartEditWithCancel}
          onDeleteTag={onDeleteTag}
          onEditChange={handleEditChange}
          onEditSubmit={handleEditSubmit}
          onEditCancel={handleEditCancel}
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
