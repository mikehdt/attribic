import { EyeIcon, EyeOffIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { Button } from '@/app/shared/button';
import { BottomShelfFrame } from '@/app/shared/shelf';
import { useToast } from '@/app/shared/toast';
import {
  IoState,
  selectFilteredAssetsCount,
  selectIoState,
  selectLoadProgress,
  selectSaveProgress,
} from '@/app/store/assets';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import {
  selectShowCropVisualization,
  toggleCropVisualization,
} from '@/app/store/project';

import { PaginationControls } from '../pagination/controls';
import { Pagination } from '../pagination/pagination';
import { IoActions } from './io-actions';
import { LoadingStatus } from './loading-status';
import { useDiscardHotkey } from './use-discard-hotkey';
import { useSaveHotkey } from './use-save-hotkey';

type TaggingBottomShelfProps = {
  currentPage?: number;
  totalPages?: number;
  basePath?: string;
};

export const TaggingBottomShelf = ({
  currentPage = 1,
  basePath,
}: TaggingBottomShelfProps) => {
  const dispatch = useAppDispatch();
  const { showToast } = useToast();

  useSaveHotkey();
  useDiscardHotkey();

  // IO state selectors
  const ioState = useAppSelector(selectIoState);
  const saveProgress = useAppSelector(selectSaveProgress) || null;
  const loadProgress = useAppSelector(selectLoadProgress) || null;

  // Crop visualisation
  const showCropVisualization = useAppSelector(selectShowCropVisualization);

  // Track previous IO state and operation type to detect completion
  const prevIoStateRef = useRef<IoState>(ioState);
  const lastOperationTypeRef = useRef<'loading' | 'saving' | null>(null);

  // Show toast when operations complete
  useEffect(() => {
    const prevIoState = prevIoStateRef.current;

    // Track the type of operation when entering LOADING or SAVING states
    if (ioState === IoState.LOADING) {
      lastOperationTypeRef.current = 'loading';
    } else if (ioState === IoState.SAVING) {
      lastOperationTypeRef.current = 'saving';
    }

    // If we transitioned from COMPLETING to COMPLETE, show completion toast based on operation type
    if (prevIoState === IoState.COMPLETING && ioState === IoState.COMPLETE) {
      const operationType = lastOperationTypeRef.current;

      if (operationType === 'loading') {
        showToast('Asset reload complete');
      } else if (operationType === 'saving') {
        showToast('Asset save complete');
      }

      // Clear the operation type after showing the toast
      lastOperationTypeRef.current = null;
    }

    // Update the ref for next comparison
    prevIoStateRef.current = ioState;
  }, [ioState, showToast]);

  const handleToggleCropVisualization = () => {
    dispatch(toggleCropVisualization());
  };

  // Get filtered asset count only - avoids re-render when array contents change but count stays same
  const filteredCount = useAppSelector(selectFilteredAssetsCount);

  const ioInProgress =
    ioState === IoState.LOADING ||
    ioState === IoState.SAVING ||
    ioState === IoState.COMPLETING;

  return (
    <BottomShelfFrame>
      <div className="flex w-1/4 items-center gap-2 text-xs whitespace-nowrap">
        <Button
          variant="ghost"
          color="slate"
          size="sm"
          onClick={handleToggleCropVisualization}
          isPressed={showCropVisualization}
          title={`${showCropVisualization ? 'Hide' : 'Show'} crop visualisation`}
        >
          {showCropVisualization ? (
            <EyeOffIcon className="h-5 w-5" />
          ) : (
            <EyeIcon className="h-5 w-5" />
          )}
        </Button>

        {ioInProgress ? (
          <LoadingStatus
            ioState={ioState}
            saveProgress={saveProgress}
            loadProgress={loadProgress}
          />
        ) : (
          <PaginationControls
            currentPage={currentPage}
            totalItems={filteredCount}
            basePath={basePath}
          />
        )}
      </div>

      <div className="flex w-2/4 items-center justify-center">
        <Pagination
          currentPage={currentPage}
          totalItems={filteredCount}
          basePath={basePath}
        />
      </div>

      <div className="flex w-1/4 items-center justify-end gap-2 text-sm">
        <IoActions ioInProgress={ioInProgress} />
      </div>
    </BottomShelfFrame>
  );
};
