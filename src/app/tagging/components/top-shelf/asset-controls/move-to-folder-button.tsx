import { FolderOutputIcon } from 'lucide-react';
import { useCallback, useState } from 'react';

import { Button } from '@/app/shared/button';
import { selectIoState } from '@/app/store/assets';
import { IoState } from '@/app/store/assets/types';
import {
  selectHasActiveFilters,
  selectHasActiveNonArchiveVisibility,
} from '@/app/store/filters';
import { useAppSelector } from '@/app/store/hooks';
import { selectWorkingSelectionCount } from '@/app/store/selection';
import { selectAssetsWithActiveFiltersCount } from '@/app/store/selection/combinedSelectors';

import { MoveToFolderModal } from './move-to-folder-modal/move-to-folder-modal';

export const MoveToFolderButton = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const selectedAssetsCount = useAppSelector(selectWorkingSelectionCount);
  const hasActiveFilters = useAppSelector(selectHasActiveFilters);
  const hasActiveVisibility = useAppSelector(
    selectHasActiveNonArchiveVisibility,
  );
  const assetsWithActiveFiltersCount = useAppSelector(
    selectAssetsWithActiveFiltersCount,
  );
  const ioState = useAppSelector(selectIoState);

  const hasActiveScope = hasActiveFilters || hasActiveVisibility;
  const canMove = selectedAssetsCount > 0 || hasActiveScope;
  const isIoBlocked =
    ioState === IoState.SAVING ||
    ioState === IoState.LOADING ||
    ioState === IoState.COMPLETING;

  const openModal = useCallback(() => setIsModalOpen(true), []);
  const closeModal = useCallback(() => setIsModalOpen(false), []);

  return (
    <>
      <Button
        type="button"
        onClick={openModal}
        disabled={!canMove || isIoBlocked}
        variant="ghost"
        color="slate"
        size="toolbar"
        title={
          isIoBlocked
            ? 'Cannot move assets while loading or saving'
            : selectedAssetsCount > 0 && hasActiveScope
              ? 'Move selected or filtered assets to a folder'
              : selectedAssetsCount > 0
                ? `Move ${selectedAssetsCount} selected assets to a folder`
                : hasActiveScope
                  ? `Move ${assetsWithActiveFiltersCount} filtered assets to a folder`
                  : 'Select assets or apply filters first'
        }
      >
        <FolderOutputIcon />
        <span className="max-xl:hidden">Move</span>
      </Button>

      <MoveToFolderModal isOpen={isModalOpen} onClose={closeModal} />
    </>
  );
};
