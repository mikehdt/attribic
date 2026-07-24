import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  XIcon,
} from 'lucide-react';
import { useEffect, useRef } from 'react';

import type { SampleImage } from '@/app/services/training/types';

import type {
  SampleColumn,
  SampleRow,
} from '../training-detail-tabs/samples-model';
import { sampleUrl } from '../training-detail-tabs/samples-model';

type SamplesLightboxProps = {
  sample: SampleImage;
  row: SampleRow;
  column: SampleColumn;
  /** Which directions have a reachable cell — dead ends render dimmed. */
  nav: { up: boolean; down: boolean; left: boolean; right: boolean };
  onClose: () => void;
  onMove: (axis: 'row' | 'col', delta: 1 | -1) => void;
};

// Elements the lightbox's own Tab trap cycles through (its chevrons + close).
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const getFocusable = (container: HTMLElement): HTMLElement[] =>
  Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => el.offsetParent !== null);

/**
 * In-place lightbox — an overlay within the modal, not a second modal. Up/Down
 * walk the same prompt across sampling events (the "is it improving?" axis);
 * Left/Right compare prompts at one event. Esc is handled here and its
 * propagation stopped so a single press closes the lightbox without also
 * reaching the `Modal`'s own Esc handler (which would close the modal).
 */
export function SamplesLightbox({
  sample,
  row,
  column,
  nav,
  onClose,
  onMove,
}: SamplesLightboxProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Focus the overlay on open so its keydown handler receives Esc/arrows before
  // they bubble to the Modal container's handler.
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Trap Tab inside the overlay. Without this it bubbles to the shared Modal's
    // focus trap, which would cycle through the grid thumbnails/tabs hidden
    // behind the overlay — and a subsequent Esc from one of those would reach
    // Modal and close the whole modal, breaking "Esc closes the lightbox first".
    if (e.key === 'Tab') {
      e.stopPropagation();
      const node = containerRef.current;
      if (!node) return;
      const focusable = getFocusable(node);
      if (focusable.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }

    switch (e.key) {
      case 'Escape':
        // Close the lightbox first; stop the event so the Modal's own Esc
        // handler doesn't also fire and close the whole modal.
        e.stopPropagation();
        onClose();
        break;
      case 'ArrowUp':
        e.preventDefault();
        onMove('row', -1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        onMove('row', 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        onMove('col', -1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        onMove('col', 1);
        break;
      default:
        break;
    }
  };

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`Sample preview — ${column.label} at ${row.label}`}
      onKeyDown={handleKeyDown}
      // -inset-6 extends over the modal's p-6 padding so the overlay covers the
      // Modal's own close button (top-3/right-3, z-1); z-20 sits above it.
      className="absolute -inset-6 z-20 flex flex-col rounded-lg bg-white/95 outline-none backdrop-blur-sm dark:bg-slate-800/95"
    >
      <div className="flex items-start justify-between gap-3 border-b border-(--border-subtle) p-3">
        {/* Labelled back route to the grid — the X alone was easy to miss. */}
        <button
          type="button"
          onClick={onClose}
          className="flex shrink-0 cursor-pointer items-center gap-0.5 rounded py-1 pr-2 pl-1 text-sm text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:hover:bg-slate-700 dark:hover:text-slate-200"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          Samples
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-500">{row.label}</p>
          <p className="text-sm break-words text-(--foreground)">
            {column.label}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="shrink-0 cursor-pointer rounded-full p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:hover:bg-slate-700 dark:hover:text-slate-200"
        >
          <XIcon className="h-5 w-5" />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- local sample served straight off disk; the optimiser adds nothing for a throwaway preview */}
        <img
          key={sample.path}
          src={sampleUrl(sample.path)}
          alt={`${column.label} — ${row.label}`}
          className="max-h-full max-w-full object-contain"
        />

        <NavButton
          className="left-2 top-1/2 -translate-y-1/2"
          label="Previous prompt"
          disabled={!nav.left}
          onClick={() => onMove('col', -1)}
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </NavButton>
        <NavButton
          className="right-2 top-1/2 -translate-y-1/2"
          label="Next prompt"
          disabled={!nav.right}
          onClick={() => onMove('col', 1)}
        >
          <ChevronRightIcon className="h-5 w-5" />
        </NavButton>
        <NavButton
          className="left-1/2 top-2 -translate-x-1/2"
          label="Newer sampling event"
          disabled={!nav.up}
          onClick={() => onMove('row', -1)}
        >
          <ChevronUpIcon className="h-5 w-5" />
        </NavButton>
        <NavButton
          className="bottom-2 left-1/2 -translate-x-1/2"
          label="Older sampling event"
          disabled={!nav.down}
          onClick={() => onMove('row', 1)}
        >
          <ChevronDownIcon className="h-5 w-5" />
        </NavButton>
      </div>
    </div>
  );
}

function NavButton({
  className,
  label,
  onClick,
  disabled = false,
  children,
}: {
  className: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`absolute rounded-full border p-1.5 shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
        disabled
          ? 'cursor-default border-slate-200 bg-white/60 text-slate-300 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-600'
          : 'cursor-pointer border-slate-300 bg-white/90 text-slate-600 hover:bg-white hover:text-slate-900 dark:border-slate-600 dark:bg-slate-900/90 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white'
      } ${className}`}
    >
      {children}
    </button>
  );
}
