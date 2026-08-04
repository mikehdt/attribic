/**
 * Drag reordering (variable-width aware):
 * - No sorting strategy — tags have uneven widths, so transform-based
 *   strategies (rectSortingStrategy) misplace them. Instead the list order
 *   itself is updated during onDragOver and flex-wrap reflows naturally,
 *   including tags wrapping between rows.
 * - Placement: the first touch on a chip displaces it by drag direction
 *   alone (anywhere on the chip counts); once a chip has been placed
 *   against, re-hovers use a centrepoint test. See handleDragUpdate.
 * - The dragged tag stays in the list as a translucent placeholder (the
 *   reserved drop space at its natural width); the floating visual is a
 *   DragOverlay that settles into the gap on drop.
 * - Position changes animate via FLIP in SortableTag (animateLayoutChanges).
 *
 * The collision detector and the drag handlers share module-level pointer
 * context, so they live together in this module.
 */
import {
  ClientRect,
  closestCenter,
  CollisionDetection,
  DragMoveEvent,
  DragOverEvent,
  DragStartEvent,
  getClientRect,
  MeasuringStrategy,
  pointerWithin,
  UniqueIdentifier,
} from '@dnd-kit/core';
import { arrayMove, SortingStrategy } from '@dnd-kit/sortable';
import { useCallback, useMemo, useRef, useState } from 'react';

import { TagData } from './types';

// Layout comes from real DOM reflow (flex-wrap), not transforms
export const noSortingStrategy: SortingStrategy = () => null;

// Re-measure drop targets during drag — reflow moves them as the order changes.
// Measure settled layout positions (ignoreTransform): during the FLIP shuffle
// animation, chips are transformed back toward their OLD spots, and measuring
// those in-flight rects makes collision detection see the pre-swap layout and
// swap back — an infinite reorder loop.
export const measuringConfig = {
  droppable: {
    strategy: MeasuringStrategy.Always,
    measure: (element: HTMLElement) =>
      getClientRect(element, { ignoreTransform: true }),
  },
};

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
export const collisionWithEdgeZones: CollisionDetection = (args) => {
  pointerEdgeZone = null;
  dragPointer = args.pointerCoordinates;

  const { pointerCoordinates, droppableRects, droppableContainers } = args;

  // Keyboard drags have no pointer — fall back to closestCenter so the
  // KeyboardSensor's requested coordinates resolve to an `over` target
  // (handleDragUpdate has a matching pointer-free placement path)
  if (!pointerCoordinates) return closestCenter(args);

  const within = pointerWithin(args);
  if (within.length > 0) return within;

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

type UseTagDragParams = {
  tags: TagData[];
  onReorder: (oldIndex: number, newIndex: number) => void;
};

export const useTagDrag = ({ tags, onReorder }: UseTagDragParams) => {
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

  // Mirror of dragOrder for the drag handlers: placement decisions need
  // current indices synchronously, and computing them inside a setState
  // updater isn't StrictMode-safe (updaters are double-invoked, so the
  // intent bookkeeping must stay outside)
  const dragOrderRef = useRef<string[] | null>(null);

  // Chips the dragged tag has been placed against this drag. A chip's first
  // touch displaces it directionally regardless of where it was hit; after
  // that it "has moved once" and re-hovers use the centrepoint test instead,
  // so it isn't endlessly re-displaced just for sitting under the pointer
  const placedChipsRef = useRef<Set<string>>(new Set());

  // A directional placement can leave the pointer on the "wrong" side of the
  // displaced chip's new midpoint (the side it was entered from). Letting the
  // centrepoint test run immediately would flip the placement straight back —
  // the jitter loop. So after a directional placement, centrepoint flips on
  // that chip are suppressed until the pointer either agrees with the current
  // placement or moves off the chip. Centrepoint flips themselves don't need
  // this: they move the chip's midpoint away from the pointer, so agreement
  // only strengthens
  const flipSuppressedChipRef = useRef<string | null>(null);

  const tagNames = useMemo(() => tags.map((t) => t.name), [tags]);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      stationaryIntentsRef.current.pointer = null;
      stationaryIntentsRef.current.applied.clear();
      placedChipsRef.current.clear();
      flipSuppressedChipRef.current = null;
      pointerEdgeZone = null;
      setActiveId(event.active.id as string);
      dragOrderRef.current = tagNames;
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

      const order = dragOrderRef.current;
      if (!order) return;

      const applyOrder = (next: string[]) => {
        dragOrderRef.current = next;
        setDragOrder(next);
      };

      // Keyboard drags have no pointer: each arrow press resolves a new
      // `over` chip (closestCenter fallback in the collision detector) and
      // the dragged tag takes its place. The pointer machinery below (edge
      // zones, stationary intents, midpoint tests) doesn't apply.
      if (!pointer) {
        if (!over || active.id === over.id) return;
        const from = order.indexOf(active.id as string);
        const to = order.indexOf(over.id as string);
        if (from === -1 || to === -1 || from === to) return;
        applyOrder(arrayMove(order, from, to));
        return;
      }

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
        const from = order.indexOf(active.id as string);
        if (from === -1) return;
        const to = zone === 'start' ? 0 : order.length - 1;
        if (to === from) return;
        station.applied.add(zoneIntent);
        flipSuppressedChipRef.current = null;
        applyOrder(arrayMove(order, from, to));
        return;
      }

      if (!over || active.id === over.id) return;
      const overId = over.id as string;

      // Hovering a different chip means any earlier directional placement is
      // no longer at risk of an immediate undo — future flips are deliberate
      if (
        flipSuppressedChipRef.current !== null &&
        flipSuppressedChipRef.current !== overId
      ) {
        flipSuppressedChipRef.current = null;
      }

      const from = order.indexOf(active.id as string);
      const iOver = order.indexOf(overId);
      if (from === -1 || iOver === -1) return;

      let after: boolean;
      if (!placedChipsRef.current.has(overId)) {
        // First touch: displace the chip by drag direction alone — anywhere
        // on the chip counts. Dragging back toward earlier positions puts the
        // dragged tag before it; dragging forward puts it after
        after = from < iOver;
      } else {
        // Already placed against once: which side of the chip's midpoint the
        // pointer is on decides placement. The axis follows the flow — a chip
        // much taller than the target (a wrapped multi-line tag) can't sit
        // beside it, so it compares vertically (top half = take its spot,
        // bottom half = slot in below); same-height chips compare
        // horizontally. Centrepoint flips move the chip's midpoint away from
        // the pointer, so a flip never re-triggers itself
        const overRect = over.rect;
        const activeRect = active.rect.current.initial;
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
        after = distFromMid > 0;

        if (flipSuppressedChipRef.current === overId) {
          const currentlyAfter = from > iOver;
          if (after !== currentlyAfter) return; // suppressed flip-back
          flipSuppressedChipRef.current = null; // pointer agrees — lift it
        }
      }

      const intent = `${overId}:${after ? 'after' : 'before'}`;
      if (station.applied.has(intent)) return;

      let to = after ? iOver + 1 : iOver;
      if (from < to) to -= 1; // removing the active item shifts the target
      if (to === from) return;
      station.applied.add(intent);
      const firstTouch = !placedChipsRef.current.has(overId);
      placedChipsRef.current.add(overId);
      // Only directional placements can leave the pointer contradicting the
      // result; protect them from an instant centrepoint undo
      flipSuppressedChipRef.current = firstTouch ? overId : null;
      applyOrder(arrayMove(order, from, to));
    },
    [],
  );

  const handleDragEnd = useCallback(() => {
    if (activeId && dragOrder) {
      const oldIndex = tagNames.indexOf(activeId);
      const newIndex = dragOrder.indexOf(activeId);
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        onReorder(oldIndex, newIndex);
      }
    }
    setActiveId(null);
    dragOrderRef.current = null;
    setDragOrder(null);
  }, [activeId, dragOrder, tagNames, onReorder]);

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    dragOrderRef.current = null;
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

  return {
    displayedTags,
    displayedNames,
    activeTag,
    handleDragStart,
    handleDragUpdate,
    handleDragEnd,
    handleDragCancel,
  };
};
