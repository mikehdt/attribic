'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useId, useRef } from 'react';

import { usePopup } from '@/app/shared/popup';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import { togglePanel } from '@/app/store/jobs';
import { openModelManagerModal } from '@/app/store/model-manager';
import { selectTheme, setTheme, type ThemeMode } from '@/app/store/preferences';

/**
 * State and handlers for the shared global menu (theme, model manager,
 * activity panel, back-to-projects). The sidecar section owns its own state via
 * {@link useSidecarStatus}.
 */
export const useGlobalMenu = () => {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const pathname = usePathname();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { openPopup, closePopup, getPopupState } = usePopup();
  const popupId = useId();

  const theme = useAppSelector(selectTheme);
  const isOpen = getPopupState(popupId).isOpen;

  const toggle = useCallback(() => {
    if (isOpen) {
      closePopup(popupId);
    } else {
      openPopup(popupId, { position: 'bottom-left', triggerRef: buttonRef });
    }
  }, [isOpen, closePopup, openPopup, popupId]);

  const handleSetTheme = useCallback(
    (mode: ThemeMode) => {
      dispatch(setTheme(mode));
    },
    [dispatch],
  );

  const handleOpenModelManager = useCallback(() => {
    closePopup(popupId);
    dispatch(openModelManagerModal(undefined));
  }, [closePopup, popupId, dispatch]);

  const handleToggleActivityPanel = useCallback(() => {
    closePopup(popupId);
    dispatch(togglePanel());
  }, [closePopup, popupId, dispatch]);

  const handleBackToProjects = useCallback(() => {
    closePopup(popupId);
    router.push('/');
  }, [closePopup, popupId, router]);

  return {
    buttonRef,
    popupId,
    isOpen,
    theme,
    toggle,
    handleSetTheme,
    handleOpenModelManager,
    handleToggleActivityPanel,
    handleBackToProjects,
    showBackToProjects: pathname !== '/',
  };
};
