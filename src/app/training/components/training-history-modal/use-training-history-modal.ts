import { useCallback, useSyncExternalStore } from 'react';

/**
 * Lightweight shared open/close state for the run-history modal, so the
 * Training menu can open it without Redux or a context provider spanning
 * the menu and the config form (mirrors the model-defaults modal).
 *
 * `entryId` is which run's detail view is showing, null for the list. It lives
 * here rather than in the modal so an opener can jump straight to one run —
 * the project menu surfaces a project's latest runs and opens the one that was
 * clicked — without the modal having to reconcile a prop against its own state.
 */

type HistoryModalState = {
  isOpen: boolean;
  entryId: string | null;
};

const CLOSED: HistoryModalState = { isOpen: false, entryId: null };

// Held as one object so useSyncExternalStore has a stable snapshot identity
// between notifications.
let state: HistoryModalState = CLOSED;
const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function notify() {
  for (const listener of listeners) listener();
}

function getSnapshot() {
  return state;
}

function getServerSnapshot() {
  return CLOSED;
}

export function useTrainingHistoryModal() {
  const { isOpen, entryId } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  /** Open the modal — on `id`'s detail view when one is given, else the list. */
  const openModal = useCallback((id?: string) => {
    state = { isOpen: true, entryId: id ?? null };
    notify();
  }, []);

  /** Show a run's detail view, or the list again with null. */
  const selectEntry = useCallback((id: string | null) => {
    state = { ...state, entryId: id };
    notify();
  }, []);

  const closeModal = useCallback(() => {
    state = CLOSED;
    notify();
  }, []);

  return { isOpen, entryId, openModal, selectEntry, closeModal };
}
