'use client';

import {
  ChevronDownIcon,
  FolderCogIcon,
  GpuIcon,
  HistoryIcon,
} from 'lucide-react';
import { memo, useCallback, useId, useRef } from 'react';

import { GlobalMenu } from '@/app/shared/global-menu';
import { MenuItem } from '@/app/shared/menu-item';
import { Popup, usePopup } from '@/app/shared/popup';
import {
  ShelfInfoRow,
  ShelfToolbarRow,
  TopShelfFrame,
} from '@/app/shared/shelf';
import { ToolbarDivider } from '@/app/shared/toolbar-divider';

import { useModelDefaultsModal } from './model-defaults-modal/use-model-defaults-modal';
import { useTrainingHistoryModal } from './training-history-modal/use-training-history-modal';
import { TrainingToolbar } from './training-toolbar';

const TrainingMenuComponent = () => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { openPopup, closePopup, getPopupState } = usePopup();
  const popupId = useId();

  const { openModal: openModelDefaults } = useModelDefaultsModal();
  const { openModal: openHistory } = useTrainingHistoryModal();
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

  const handleOpenHistory = useCallback(() => {
    closePopup(popupId);
    openHistory();
  }, [closePopup, popupId, openHistory]);

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
        <GpuIcon className="h-5 w-5 text-(--unselected-text)" />
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
          <MenuItem
            icon={<FolderCogIcon className="h-5 w-5" />}
            label="Model Defaults…"
            onClick={handleOpenModelDefaults}
          />
          <MenuItem
            icon={<HistoryIcon className="h-5 w-5" />}
            label="Run History…"
            onClick={handleOpenHistory}
          />
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
        <GlobalMenu />

        <ToolbarDivider />

        <TrainingMenu />
      </ShelfInfoRow>
      <ShelfToolbarRow>
        <TrainingToolbar />
      </ShelfToolbarRow>
    </TopShelfFrame>
  );
};
