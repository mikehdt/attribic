# Tagging Components (v2)

Tag management components for viewing, editing, and organising image tags with drag-and-drop reordering support.

## Component Hierarchy

```
TaggingManager           # Redux integration layer, provides handlers
└── TagList              # Manages add/edit state, duplicate detection
    └── TagsDisplay      # Conditional DnD context, renders tag elements
        ├── SortableTag  # DnD wrapper (when sortable + hovered)
        │   └── EditableTag
        │       ├── Tag       # Display mode
        │       └── InputTag  # Edit mode
        └── EditableTag  # Direct render (when not sortable/hovered)
            ├── Tag
            └── InputTag
```

## Features

- Add, edit, delete, and toggle tags
- Drag-and-drop reordering (when tag sort is set to "Sort Order")
- Duplicate detection with visual feedback (matching tag highlighted, others faded)
- Case-insensitive duplicate matching
- Conditional DnD rendering for performance (only active when hovered)
- Memoized components to minimise re-renders

## Drag-and-Drop Reordering

Tags have uneven widths, so transform-based dnd-kit strategies
(`rectSortingStrategy`) misplace them. Instead:

- No sorting strategy — the display order itself is reordered in `onDragOver`
  (local `dragOrder` state in TagsDisplay) and flex-wrap reflows naturally,
  including tags wrapping between rows
- The dragged tag stays in the list as a translucent placeholder — the
  reserved drop space at its natural width; the pointer-following visual is a
  `DragOverlay` that settles into the gap on drop
- Position changes animate via FLIP (`animateLayoutChanges: () => true`)
- Two guards prevent infinite reorder loops (`MeasuringStrategy.Always`
  re-fires collisions after every reflow without pointer movement):
  droppables are measured with `ignoreTransform` so mid-animation chips
  don't report stale rects, and a hysteresis ref skips re-swapping the same
  target until the pointer actually moves
- `pointerWithin`-based collision detection — its no-op states (pointer over
  the placeholder or in a gap) let the layout settle between swaps — extended
  with an end zone: a pointer past the flow-last chip targets the end of the
  list, since the empty space after the last chip hits no chip directly
- Redux is only updated once, on drop (`onReorder(oldIndex, newIndex)`);
  Escape cancels and restores the original order

## State Management

- **TaggingManager**: Connects to Redux store for tag data and dispatches actions
- **TagList**: Local state for add input value and edit state (editingTagName, editValue)
- **TagsDisplay**: Local state for hover detection (enables/disables DnD context)

## Visual States

Tags display different colours based on their state:

- **Saved** (teal): Tag exists in the source file
- **To Add** (amber): New tag pending save
- **Dirty** (indigo): Tag modified pending save
- **To Delete** (pink): Tag marked for deletion, shown with strikethrough

## Duplicate Detection

When typing in the add or edit input matches an existing tag:

1. All other tags fade out (opacity 25%, non-interactive)
2. The matching tag remains visible but non-interactive (no edit/delete/drag)
3. Submit is disabled until the duplicate is resolved

## Props

### TaggingManager

| Prop      | Type     | Description                     |
| --------- | -------- | ------------------------------- |
| `assetId` | `string` | The asset ID to manage tags for |

### TagList

| Prop          | Type                                 | Description                      |
| ------------- | ------------------------------------ | -------------------------------- |
| `tags`        | `TagData[]`                          | Array of tag objects to display  |
| `sortable`    | `boolean`                            | Enable drag-and-drop reordering  |
| `assetId`     | `string`                             | Asset identifier for DnD context |
| `sensors`     | `SensorDescriptor[]`                 | DnD sensors from useSensors      |
| `onReorder`   | `(oldIndex, newIndex) => void`       | Called with final drop indices   |
| `onAddTag`    | `(tagName: string) => void`          | Called to add a new tag          |
| `onToggleTag` | `(tagName: string) => void`          | Called to toggle tag filter      |
| `onEditTag`   | `(old: string, new: string) => void` | Called to rename a tag           |
| `onDeleteTag` | `(tagName: string) => void`          | Called to mark tag for deletion  |
