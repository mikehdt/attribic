import { useCallback, useSyncExternalStore } from 'react';

/**
 * Lightweight shared open/close state for the run-history modal, so the
 * Training menu can open it without Redux or a context provider spanning
 * the menu and the config form (mirrors the model-defaults modal).
 */

let isOpen = false;
const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function notify() {
  for (const listener of listeners) listener();
}

function getSnapshot() {
  return isOpen;
}

function getServerSnapshot() {
  return false;
}

export function useTrainingHistoryModal() {
  const open = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const openModal = useCallback(() => {
    isOpen = true;
    notify();
  }, []);

  const closeModal = useCallback(() => {
    isOpen = false;
    notify();
  }, []);

  return { isOpen: open, openModal, closeModal };
}
