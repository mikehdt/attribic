'use client';

import { Fragment } from 'react';

import { Modal } from '@/app/shared/modal';

type KeyboardShortcutsModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

type Shortcut = {
  /** Alternative bindings, each a +-joined combo (e.g. 'Ctrl+Del'). */
  keys: string[];
  description: string;
};

type ShortcutGroup = {
  title: string;
  shortcuts: Shortcut[];
};

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Navigate',
    shortcuts: [
      { keys: ['←', '→'], description: 'Previous / next asset' },
      {
        keys: ['↑', '↓'],
        description: 'Asset above / below',
      },
      {
        keys: ['PgUp', 'PgDn'],
        description: 'Move up / down a page',
      },
      { keys: ['Home', 'End'], description: 'First / last asset on the page' },
      {
        keys: ['Ctrl+U'],
        description:
          'Jump to the first untagged asset, changing page if needed',
      },
      {
        keys: ['Esc'],
        description: 'Move back to list, again to clear highlight',
      },
    ],
  },
  {
    title: 'Select',
    shortcuts: [
      {
        keys: ['Space', 'Enter'],
        description: 'Select / de-select the asset',
      },
      {
        keys: ['Shift+↑ ↓ ← →'],
        description: 'Hold while navigating to preview a selection range',
      },
      {
        keys: ['Shift+Space', 'Shift+Enter'],
        description: 'Set the selection',
      },
    ],
  },
  {
    title: 'Edit',
    shortcuts: [
      {
        keys: ['Tab'],
        description: 'Open the highlighted asset’s tags',
      },
      {
        keys: ['Z'],
        description: 'Toggle the highlighted asset’s zoom',
      },
      {
        keys: ['Ctrl+S'],
        description:
          'Save the highlighted asset’s changes (works while typing)',
      },
      {
        keys: ['Ctrl+Shift+S'],
        description: 'Save all pending changes',
      },
      {
        keys: ['Ctrl+D'],
        description:
          'Discard the highlighted asset’s changes (works while typing)',
      },
      {
        keys: ['Ctrl+Shift+D'],
        description: 'Discard all pending changes',
      },
    ],
  },
  {
    title: 'Organise',
    shortcuts: [
      {
        keys: ['Ctrl+Del', 'Ctrl+Backspace'],
        description:
          'Archive / un-archive the selection, plus the highlighted asset',
      },
    ],
  },
];

const Key = ({ combo }: { combo: string }) => (
  <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
    {combo.split('+').map((key, index) => (
      <Fragment key={index}>
        {index > 0 && <span className="text-slate-400">+</span>}
        <kbd className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 font-sans text-xs font-medium text-slate-600 shadow-[0_1px_0] shadow-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300 dark:shadow-slate-900">
          {key}
        </kbd>
      </Fragment>
    ))}
  </span>
);

/** Grouped reference of the gallery keyboard shortcuts. */
export const KeyboardShortcutsModal = ({
  isOpen,
  onClose,
}: KeyboardShortcutsModalProps) => (
  <Modal
    isOpen={isOpen}
    onClose={onClose}
    className="max-w-3xl"
    labelledById="keyboard-shortcuts-modal-title"
  >
    <div className="flex flex-col gap-4">
      <h2
        id="keyboard-shortcuts-modal-title"
        className="text-2xl font-semibold text-slate-700 dark:text-slate-200"
      >
        Keyboard shortcuts
      </h2>

      <p className="text-sm text-slate-500">
        Use the arrow keys to highlight an asset, then work on it without
        leaving the keyboard. Shortcuts stay out of the way while you’re typing
        in a text field.
      </p>

      <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title}>
            <h3 className="mb-2 border-b border-slate-200 pb-1 text-sm font-semibold tracking-wide text-slate-600 uppercase dark:border-slate-700 dark:text-slate-300">
              {group.title}
            </h3>
            <dl className="flex flex-col gap-3">
              {group.shortcuts.map((shortcut) => (
                <div
                  key={shortcut.keys.join()}
                  className="flex items-center justify-between gap-4"
                >
                  <dt className="shrink-0">
                    {shortcut.keys.map((combo, index) => (
                      <Fragment key={combo}>
                        {index > 0 && (
                          <span className="mx-1 text-xs text-slate-400">
                            or
                          </span>
                        )}
                        <Key combo={combo} />
                      </Fragment>
                    ))}
                  </dt>
                  <dd className="text-right text-sm text-slate-500 dark:text-slate-400">
                    {shortcut.description}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>

      <p className="border-t border-slate-200 pt-3 text-sm text-slate-500 dark:border-slate-700">
        Press <Key combo="?" /> anywhere in the gallery to open this reference.
      </p>
    </div>
  </Modal>
);
