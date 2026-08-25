'use client';

import { useSortable } from '@dnd-kit/sortable';
import { GripVerticalIcon, Trash2Icon } from 'lucide-react';

import {
  resolveSampleSize,
  type SampleAspect,
  type SampleBase,
} from '@/app/services/training/sample-sizes';
import { Button } from '@/app/shared/button';
import { Dropdown, type DropdownItem } from '@/app/shared/dropdown';
import { Input } from '@/app/shared/input/input';
import { InputTray } from '@/app/shared/input-tray/input-tray';

type SortablePromptRowProps = {
  id: string;
  index: number;
  prompt: string;
  aspect: SampleAspect;
  sampleBase: SampleBase;
  aspectItems: DropdownItem<SampleAspect>[];
  /** Both reordering and removal are meaningless with a single prompt. */
  sortable: boolean;
  onChange: (index: number, value: string) => void;
  onChangeAspect: (index: number, value: SampleAspect) => void;
  onRemove: (index: number) => void;
};

/**
 * One sample prompt: its text, the shape it renders at, and a handle to move
 * it up or down the list.
 *
 * The drag listeners sit on the handle alone rather than the whole row — the
 * row is mostly a text field, and a press-and-move inside it has to mean
 * selecting text.
 */
export function SortablePromptRow({
  id,
  index,
  prompt,
  aspect,
  sampleBase,
  aspectItems,
  sortable,
  onChange,
  onChangeAspect,
  onRemove,
}: SortablePromptRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !sortable });

  const [width, height] = resolveSampleSize(aspect, sampleBase);

  const style = {
    // Vertical only. The list is a single column, so sideways travel would be
    // movement the drop can't express (and `@dnd-kit/modifiers`, which does
    // this properly, isn't a dependency for one axis lock).
    transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined,
    transition,
    // Lift the row being dragged over the ones shuffling past it.
    zIndex: isDragging ? 1 : undefined,
    position: 'relative' as const,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-1.5">
      {sortable && (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          title="Drag to reorder"
          aria-label={`Reorder prompt ${index + 1}`}
          className="shrink-0 cursor-grab touch-none rounded-sm p-0.5 text-slate-400 transition-colors hover:text-slate-600 active:cursor-grabbing dark:text-slate-500 dark:hover:text-slate-300"
        >
          <GripVerticalIcon className="h-4 w-4" />
        </button>
      )}
      <InputTray width="full" size="md" tone="surface">
        <Input
          type="text"
          value={prompt}
          onChange={(e) => onChange(index, e.target.value)}
          placeholder="e.g. a woman with red hair, sitting at a cafe"
          className="min-w-0 flex-1"
        />
        <Dropdown
          items={aspectItems}
          selectedValue={aspect}
          onChange={(val) => onChangeAspect(index, val)}
          selectedValueRenderer={() => (
            <span className="tabular-nums">
              {width} × {height}
            </span>
          )}
          aria-label={`Sample image size for prompt ${index + 1}`}
          className="shrink-0"
        />
        {sortable && (
          <Button
            variant="ghost"
            onClick={() => onRemove(index)}
            title="Remove prompt"
          >
            <Trash2Icon />
          </Button>
        )}
      </InputTray>
    </div>
  );
}
