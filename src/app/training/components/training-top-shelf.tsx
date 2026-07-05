'use client';

import {
  ArrowLeftCircleIcon,
  ChevronDownIcon,
  FolderCogIcon,
  GraduationCapIcon,
  RefreshCwIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { memo, useCallback, useId, useRef, useState } from 'react';

import { MenuThemeSwitcher } from '@/app/shared/menu-theme-switcher';
import { Popup, usePopup } from '@/app/shared/popup';
import {
  ShelfInfoRow,
  ShelfToolbarRow,
  TopShelfFrame,
} from '@/app/shared/shelf';
import { useToast } from '@/app/shared/toast/hooks/use-toast';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import { selectGpuBusyReason } from '@/app/store/jobs';
import { selectTheme, setTheme } from '@/app/store/preferences';
import { type ThemeMode } from '@/app/utils/use-theme';

import { useModelDefaultsModal } from './model-defaults-modal/use-model-defaults-modal';
import { TrainingToolbar } from './training-toolbar';

const TrainingMenuComponent = () => {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { openPopup, closePopup, getPopupState } = usePopup();
  const popupId = useId();

  const theme = useAppSelector(selectTheme);
  const gpuBusyReason = useAppSelector(selectGpuBusyReason);
  const { showToast, showErrorToast } = useToast();
  const [restarting, setRestarting] = useState(false);
  const { openModal: openModelDefaults } = useModelDefaultsModal();
  const isOpen = getPopupState(popupId).isOpen;

  const handleToggle = useCallback(() => {
    if (isOpen) {
      closePopup(popupId);
    } else {
      openPopup(popupId, {
        position: 'bottom-left',
        triggerRef: buttonRef,
      });
    }
  }, [isOpen, closePopup, openPopup, popupId]);

  const handleOpenModelDefaults = useCallback(() => {
    closePopup(popupId);
    openModelDefaults();
  }, [closePopup, popupId, openModelDefaults]);

  const handleBackToProjects = useCallback(() => {
    closePopup(popupId);
    router.push('/');
  }, [closePopup, popupId, router]);

  const handleRestartSidecar = useCallback(async () => {
    closePopup(popupId);
    if (restarting) return;

    // Restarting kills whatever the sidecar is doing. If we know a GPU job is
    // running, make the user confirm before we force it.
    const force = gpuBusyReason !== null;
    if (force) {
      const ok = window.confirm(
        `A ${gpuBusyReason} job is running on the sidecar. Restarting will stop it. Continue?`,
      );
      if (!ok) return;
    }

    setRestarting(true);
    try {
      const res = await fetch('/api/training/sidecar/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 409) {
        // A job started between our check and the click — surface it rather
        // than silently killing it.
        showErrorToast(
          'A job is running on the sidecar — restart cancelled. Cancel the job first, or retry to force.',
        );
        return;
      }
      if (res.ok && data.status === 'ready') {
        showToast('Sidecar restarted.');
      } else {
        showErrorToast(`Sidecar restart failed: ${data.error ?? 'unknown error'}`);
      }
    } catch (err) {
      showErrorToast(
        `Sidecar restart failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    } finally {
      setRestarting(false);
    }
  }, [
    closePopup,
    popupId,
    restarting,
    gpuBusyReason,
    showToast,
    showErrorToast,
  ]);

  const handleSetTheme = useCallback(
    (mode: ThemeMode) => {
      dispatch(setTheme(mode));
    },
    [dispatch],
  );

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        className={`flex cursor-pointer items-center gap-2 rounded-sm px-1 py-0.5 transition-colors ${
          isOpen ? 'bg-(--surface)' : 'hover:bg-(--surface)/50'
        }`}
      >
        <GraduationCapIcon className="h-5 w-5 text-(--unselected-text)" />
        <span className="font-medium text-(--foreground)">Training</span>
        <ChevronDownIcon
          className={`h-3 w-3 text-(--unselected-text) transition-transform ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      <Popup
        id={popupId}
        position="bottom-left"
        triggerRef={buttonRef}
        className="min-w-48 rounded-md border border-slate-200 bg-white shadow-lg shadow-slate-600/50 dark:border-slate-600 dark:bg-slate-800 dark:shadow-slate-950/50"
      >
        <div className="divide-y divide-slate-100 dark:divide-slate-700">
          <button
            type="button"
            onClick={handleOpenModelDefaults}
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            <span className="h-5 w-5">
              <FolderCogIcon className="h-5 w-5" />
            </span>
            Model Defaults…
          </button>

          <MenuThemeSwitcher theme={theme} setTheme={handleSetTheme} />

          <button
            type="button"
            onClick={handleRestartSidecar}
            disabled={restarting}
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-default disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-700"
            title="Kill and re-spawn the Python sidecar to pick up code changes"
          >
            <span className="h-5 w-5">
              <RefreshCwIcon
                className={`h-5 w-5 ${restarting ? 'animate-spin' : ''}`}
              />
            </span>
            {restarting ? 'Restarting sidecar…' : 'Restart Sidecar'}
          </button>

          <button
            type="button"
            onClick={handleBackToProjects}
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            <span className="h-5 w-5">
              <ArrowLeftCircleIcon className="h-5 w-5" />
            </span>
            Back to Projects
          </button>
        </div>
      </Popup>
    </div>
  );
};

const TrainingMenu = memo(TrainingMenuComponent);

export const TrainingTopShelf = () => {
  return (
    <TopShelfFrame>
      <ShelfInfoRow>
        <TrainingMenu />
      </ShelfInfoRow>
      <ShelfToolbarRow>
        <TrainingToolbar />
      </ShelfToolbarRow>
    </TopShelfFrame>
  );
};
