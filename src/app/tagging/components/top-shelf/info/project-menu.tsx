import {
  BoxIcon,
  CalculatorIcon,
  ChevronDownIcon,
  MessageSquareTextIcon,
  RefreshCwIcon,
} from 'lucide-react';
import Image from 'next/image';
import { memo, useCallback, useId, useRef, useState } from 'react';

import { MenuEditModeSwitcher } from '@/app/shared/menu-edit-mode-switcher';
import { MenuItem } from '@/app/shared/menu-item';
import { Popup, usePopup } from '@/app/shared/popup';
import {
  IoState,
  loadAllAssets,
  reconcileCaptionsForMode,
  selectAllImages,
  selectIoState,
  stripCaptionsForTagMode,
} from '@/app/store/assets';
import { hasHybridDelimiter } from '@/app/store/assets/hybrid-caption';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import {
  selectTagEditMode,
  setTagEditMode,
  TagEditMode,
} from '@/app/store/preferences';
import {
  type CaptionMode,
  selectCaptionMode,
  selectProjectFolderName,
  selectProjectHasThumbnail,
  selectProjectName,
  selectProjectThumbnailVersion,
  setCaptionMode,
} from '@/app/store/project';
import { updateProject } from '@/app/utils/project-actions';
import { projectThumbnailSrc } from '@/app/utils/project-thumbnail';

import { BucketCropModal } from '../asset-controls/bucket-crop-modal';
import { CaptionPromptModal } from './caption-prompt-modal';
import { MenuCaptionModeSwitcher } from './menu-caption-mode-switcher';
import { SwitchToHybridModal } from './switch-to-hybrid-modal';
import { SwitchToTagsModal } from './switch-to-tags-modal';

const ProjectMenuComponent = () => {
  const dispatch = useAppDispatch();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { openPopup, closePopup, getPopupState } = usePopup();
  const popupId = useId();

  const projectName = useAppSelector(selectProjectName);
  const projectFolderName = useAppSelector(selectProjectFolderName);
  const hasThumbnail = useAppSelector(selectProjectHasThumbnail);
  const thumbnailVersion = useAppSelector(selectProjectThumbnailVersion);
  const ioState = useAppSelector(selectIoState);

  const tagEditMode = useAppSelector(selectTagEditMode);
  const captionMode = useAppSelector(selectCaptionMode);
  const images = useAppSelector(selectAllImages);

  const [isBucketModalOpen, setIsBucketModalOpen] = useState(false);
  const [isPromptModalOpen, setIsPromptModalOpen] = useState(false);
  // Non-zero while the hybrid→tags confirm dialog is open; holds the count of
  // captions that would be discarded.
  const [switchToTagsCount, setSwitchToTagsCount] = useState<number | null>(
    null,
  );
  // Non-null while the caption→hybrid confirm dialog is open; holds the count of
  // assets whose caption text hybrid can't re-derive on its own.
  const [switchToHybridCount, setSwitchToHybridCount] = useState<number | null>(
    null,
  );

  // Build thumbnail src
  const thumbnailSrc =
    hasThumbnail && projectFolderName
      ? projectThumbnailSrc(projectFolderName, thumbnailVersion)
      : null;

  const isOpen = getPopupState(popupId).isOpen;
  const ioInProgress =
    ioState === IoState.LOADING ||
    ioState === IoState.SAVING ||
    ioState === IoState.COMPLETING;

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

  const handleRefresh = useCallback(() => {
    closePopup(popupId);
    if (projectFolderName) {
      dispatch(
        loadAllAssets({
          maintainIoState: false,
          projectPath: projectFolderName,
        }),
      );
    }
  }, [closePopup, popupId, dispatch, projectFolderName]);

  const handleOpenBucketModal = useCallback(() => {
    closePopup(popupId);
    setIsBucketModalOpen(true);
  }, [closePopup, popupId]);

  const handleCloseBucketModal = useCallback(() => {
    setIsBucketModalOpen(false);
  }, []);

  const handleOpenPromptModal = useCallback(() => {
    closePopup(popupId);
    setIsPromptModalOpen(true);
  }, [closePopup, popupId]);

  const handleClosePromptModal = useCallback(() => {
    setIsPromptModalOpen(false);
  }, []);

  const handleSetTagEditMode = useCallback(
    (mode: TagEditMode) => {
      dispatch(setTagEditMode(mode));
    },
    [dispatch],
  );

  const commitCaptionMode = useCallback(
    (mode: CaptionMode, ambiguousCaption: 'keep' | 'clear' = 'clear') => {
      // Re-derive caption state for the incoming mode before the switch lands,
      // so the editors don't surface text the new mode doesn't mean.
      dispatch(
        reconcileCaptionsForMode({
          from: captionMode,
          to: mode,
          ambiguousCaption,
        }),
      );
      dispatch(setCaptionMode(mode));
      if (projectFolderName) {
        updateProject(projectFolderName, { captionMode: mode });
      }
    },
    [dispatch, captionMode, projectFolderName],
  );

  const handleSetCaptionMode = useCallback(
    (mode: CaptionMode) => {
      // Leaving hybrid for tag-only mode discards captions on save. If any
      // loaded asset carries a caption, confirm before switching.
      if (captionMode === 'hybrid' && mode === 'tags') {
        const captionCount = images.filter((img) =>
          img.savedCaptionText.trim(),
        ).length;
        if (captionCount > 0) {
          setSwitchToTagsCount(captionCount);
          return;
        }
      }

      // Leaving caption for hybrid: caption text still carrying the delimiter
      // splits back apart on its own, but anything else is ambiguous — it may be
      // a tag block echoed in on the way into caption mode. Confirm those.
      if (captionMode === 'caption' && mode === 'hybrid') {
        const ambiguousCount = images.filter(
          (img) =>
            img.captionText.trim() && !hasHybridDelimiter(img.captionText),
        ).length;
        if (ambiguousCount > 0) {
          setSwitchToHybridCount(ambiguousCount);
          return;
        }
      }

      commitCaptionMode(mode);
    },
    [captionMode, images, commitCaptionMode],
  );

  const handleConfirmSwitchToTags = useCallback(async () => {
    await dispatch(
      stripCaptionsForTagMode(
        projectFolderName ? { projectPath: projectFolderName } : undefined,
      ),
    );
    commitCaptionMode('tags');
  }, [dispatch, projectFolderName, commitCaptionMode]);

  const handleCloseSwitchToTags = useCallback(
    () => setSwitchToTagsCount(null),
    [],
  );

  const handleCloseSwitchToHybrid = useCallback(
    () => setSwitchToHybridCount(null),
    [],
  );

  const handleKeepCaptionsForHybrid = useCallback(() => {
    commitCaptionMode('hybrid', 'keep');
    setSwitchToHybridCount(null);
  }, [commitCaptionMode]);

  const handleClearCaptionsForHybrid = useCallback(() => {
    commitCaptionMode('hybrid', 'clear');
    setSwitchToHybridCount(null);
  }, [commitCaptionMode]);

  if (!projectName) {
    return null;
  }

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
        {thumbnailSrc ? (
          <Image
            src={thumbnailSrc}
            alt={`${projectName} thumbnail`}
            width={20}
            height={20}
            priority
            className="h-6 w-6 rounded-full object-cover"
          />
        ) : (
          <BoxIcon className="h-6 w-6 rounded-full bg-(--surface) p-1 text-(--unselected-text)" />
        )}
        <span className="font-medium text-(--foreground)">{projectName}</span>
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
            icon={<RefreshCwIcon className="h-5 w-5" />}
            label="Refresh Assets"
            onClick={handleRefresh}
            disabled={ioInProgress}
          />
          <MenuItem
            icon={<CalculatorIcon className="h-5 w-5" />}
            label="Bucket Visualisation Tool"
            onClick={handleOpenBucketModal}
          />

          <MenuCaptionModeSwitcher
            captionMode={captionMode}
            setCaptionMode={handleSetCaptionMode}
          />

          {/* Only the modes that actually produce natural-language captions
              have a prompt to author. */}
          {(captionMode === 'caption' || captionMode === 'hybrid') && (
            <MenuItem
              icon={<MessageSquareTextIcon className="h-5 w-5" />}
              label="Edit Caption Prompt"
              onClick={handleOpenPromptModal}
            />
          )}

          <MenuEditModeSwitcher
            editMode={tagEditMode}
            setEditMode={handleSetTagEditMode}
          />
        </div>
      </Popup>

      <BucketCropModal
        isOpen={isBucketModalOpen}
        onClose={handleCloseBucketModal}
      />

      <CaptionPromptModal
        isOpen={isPromptModalOpen}
        onClose={handleClosePromptModal}
      />

      <SwitchToTagsModal
        isOpen={switchToTagsCount !== null}
        captionCount={switchToTagsCount ?? 0}
        onClose={handleCloseSwitchToTags}
        onConfirm={handleConfirmSwitchToTags}
      />

      <SwitchToHybridModal
        isOpen={switchToHybridCount !== null}
        ambiguousCount={switchToHybridCount ?? 0}
        onClose={handleCloseSwitchToHybrid}
        onKeep={handleKeepCaptionsForHybrid}
        onClear={handleClearCaptionsForHybrid}
      />
    </div>
  );
};

export const ProjectMenu = memo(ProjectMenuComponent);
