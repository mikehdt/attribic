'use client';

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { PlusIcon } from 'lucide-react';
import { useCallback } from 'react';

import type {
  SampleAspect,
  SampleBase,
} from '@/app/services/training/sample-sizes';
import { Button } from '@/app/shared/button';
import type { DropdownItem } from '@/app/shared/dropdown';
import { FormTitle } from '@/app/shared/form-title/form-title';

import { SortablePromptRow } from './sortable-prompt-row';

type SamplePromptsProps = {
  prompts: string[];
  /** Index-aligned with `prompts`; may be short on older saved configs. */
  sizes: SampleAspect[];
  /** What a prompt with no shape of its own renders at. */
  fallbackAspect: SampleAspect;
  sampleBase: SampleBase;
  aspectItems: DropdownItem<SampleAspect>[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onSet: (index: number, value: string) => void;
  onSetSize: (index: number, value: SampleAspect) => void;
  onReorder: (from: number, to: number) => void;
};

/**
 * The editable list of sample prompts, reorderable by dragging a row's handle.
 *
 * Order matters beyond taste: samples are written out in prompt order, so the
 * prompt you care most about is worth having first — it's the one you glance at
 * in the grid mid-run.
 *
 * Rows are identified by position rather than by their text: prompts are plain
 * strings, and a list can legitimately hold two identical ones (or several
 * empty ones), which the sorter still has to tell apart.
 */
export function SamplePrompts({
  prompts,
  sizes,
  fallbackAspect,
  sampleBase,
  aspectItems,
  onAdd,
  onRemove,
  onSet,
  onSetSize,
  onReorder,
}: SamplePromptsProps) {
  // A short activation distance keeps the handle clickable-feeling while still
  // letting a deliberate drag start straight away.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const ids = prompts.map((_, i) => `prompt-${i}`);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const from = ids.indexOf(active.id as string);
      const to = ids.indexOf(over.id as string);
      if (from === -1 || to === -1) return;
      onReorder(from, to);
    },
    [ids, onReorder],
  );

  // One prompt can't be reordered or removed — the run needs something to
  // sample with, and there's nothing to move it past.
  const sortable = prompts.length > 1;

  return (
    <div>
      <FormTitle>Sample Prompts</FormTitle>
      <div className="mb-1.5 space-y-1.5">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            {prompts.map((prompt, i) => (
              <SortablePromptRow
                key={ids[i]}
                id={ids[i]}
                index={i}
                prompt={prompt}
                aspect={sizes[i] ?? fallbackAspect}
                sampleBase={sampleBase}
                aspectItems={aspectItems}
                sortable={sortable}
                onChange={onSet}
                onChangeAspect={onSetSize}
                onRemove={onRemove}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>

      <Button variant="ghost" size="sm" width="sm" onClick={onAdd}>
        <PlusIcon />
        Add prompt
      </Button>
    </div>
  );
}
