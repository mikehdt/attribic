'use client';

import { ArrowLeftCircleIcon, BoxesIcon, MenuIcon } from 'lucide-react';
import { memo } from 'react';

import { MenuItem } from '@/app/shared/menu-item';
import { MenuThemeSwitcher } from '@/app/shared/menu-theme-switcher';
import { Popup } from '@/app/shared/popup';

import { SidecarControls } from './sidecar-controls';
import { useGlobalMenu } from './use-global-menu';

const GlobalMenuComponent = () => {
  const {
    buttonRef,
    popupId,
    isOpen,
    theme,
    toggle,
    handleSetTheme,
    handleOpenModelManager,
    handleBackToProjects,
    showBackToProjects,
  } = useGlobalMenu();

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        title="Menu"
        aria-label="Menu"
        className={`flex cursor-pointer items-center rounded-sm px-1 py-0.5 transition-colors ${
          isOpen ? 'bg-(--surface)' : 'hover:bg-(--surface)/50'
        }`}
      >
        <MenuIcon className="mr-2 h-5 w-5" /> App
      </button>

      <Popup
        id={popupId}
        position="bottom-left"
        triggerRef={buttonRef}
        className="min-w-56 rounded-md border border-slate-200 bg-white shadow-lg shadow-slate-600/50 dark:border-slate-600 dark:bg-slate-800 dark:shadow-slate-950/50"
      >
        <div className="divide-y divide-slate-100 dark:divide-slate-700">
          <MenuThemeSwitcher theme={theme} setTheme={handleSetTheme} />

          <MenuItem
            icon={<BoxesIcon className="h-5 w-5" />}
            label="Model Manager"
            onClick={handleOpenModelManager}
          />

          <SidecarControls enabled={isOpen} />

          {showBackToProjects && (
            <MenuItem
              icon={<ArrowLeftCircleIcon className="h-5 w-5" />}
              label="Back to Projects"
              onClick={handleBackToProjects}
            />
          )}
        </div>
      </Popup>
    </div>
  );
};

export const GlobalMenu = memo(GlobalMenuComponent);
