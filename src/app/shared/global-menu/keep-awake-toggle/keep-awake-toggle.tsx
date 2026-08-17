'use client';

import { CoffeeIcon } from 'lucide-react';

import { useKeepAwakeToggle } from './use-keep-awake-toggle';

type KeepAwakeToggleProps = {
  /** Whether the containing menu is open — gates the config read. */
  enabled: boolean;
};

/**
 * Global-menu switch for the host sleep inhibition. The sidecar does the
 * actual work (training-sidecar/power.py); this only writes the config key it
 * reads, so the lock still applies with no browser open at all.
 *
 * System sleep only — the display and screensaver are left alone, because
 * nobody wants a monitor held on through a six-hour run.
 */
export const KeepAwakeToggle = ({ enabled }: KeepAwakeToggleProps) => {
  const { value, error, toggle } = useKeepAwakeToggle(enabled);

  const loading = value === null;
  const on = value === true;

  return (
    <div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={loading}
        onClick={toggle}
        title="Stops the computer idle-sleeping while training, tagging, captioning or downloading. The display can still switch off."
        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
          loading
            ? 'cursor-wait text-slate-400 dark:text-slate-500'
            : 'cursor-pointer text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'
        }`}
      >
        <CoffeeIcon className="h-5 w-5 shrink-0" />
        Prevent Sleep During GPU Use
        <span
          aria-hidden
          className={`ml-auto flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
            on ? 'bg-sky-500' : 'bg-slate-300 dark:bg-slate-600'
          } ${loading ? 'opacity-50' : ''}`}
        >
          <span
            className={`h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
              on ? 'translate-x-3.5' : 'translate-x-0.5'
            }`}
          />
        </span>
      </button>

      {error && (
        <p className="px-3 pb-2 text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
};
