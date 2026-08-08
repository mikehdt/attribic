import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  selectAllImages,
  selectAllSubfolders,
  selectIoState,
} from '@/app/store/assets';
import { moveAssetsToFolderThunk } from '@/app/store/assets/actions';
import { IoState } from '@/app/store/assets/types';
import {
  selectHasActiveFilters,
  selectHasActiveVisibility,
} from '@/app/store/filters';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import { selectProjectInfo } from '@/app/store/project';
import {
  clearSelection,
  selectAssetsWithActiveFilters,
  selectAssetsWithActiveFiltersCount,
  selectSelectedAssets,
  selectSelectedAssetsCount,
} from '@/app/store/selection';
import { ARCHIVE_FOLDER, parseSubfolder } from '@/app/utils/subfolder-utils';

const DESTINATION_ROOT = '__root__';
const DESTINATION_NEW = '__new__';
const DESTINATION_ARCHIVE = '__archive__';

// Regex for the label portion of a repeat folder name
const LABEL_PATTERN = /^[a-zA-Z0-9-]+$/;

type UseMoveToFolderModalParams = {
  isOpen: boolean;
  onClose: () => void;
};

export const useMoveToFolderModal = ({
  isOpen,
  onClose,
}: UseMoveToFolderModalParams) => {
  const dispatch = useAppDispatch();

  // Scoping state
  const [applyToSelectedAssets, setApplyToSelectedAssets] = useState(false);
  const [applyToAssetsWithActiveFilters, setApplyToAssetsWithActiveFilters] =
    useState(false);

  // Keep selection after move
  const [keepSelection, setKeepSelection] = useState(false);

  // Destination state
  const [selectedDestination, setSelectedDestination] = useState('');
  const [newRepeatCount, setNewRepeatCount] = useState(1);
  const [newLabel, setNewLabel] = useState('');

  // Rename state, seeded from the folder when it is picked as the destination
  const [renameRepeatCount, setRenameRepeatCount] = useState(1);
  const [renameLabel, setRenameLabel] = useState('');

  // Progress and error state
  const [isMoving, setIsMoving] = useState(false);
  const [collisionError, setCollisionError] = useState<string[] | null>(null);
  const [moveErrors, setMoveErrors] = useState<string[] | null>(null);

  // Selectors
  const hasExplicitFilters = useAppSelector(selectHasActiveFilters);
  const hasActiveVisibility = useAppSelector(selectHasActiveVisibility);
  const hasActiveFilters = hasExplicitFilters || hasActiveVisibility;
  const selectedAssets = useAppSelector(selectSelectedAssets);
  const selectedAssetsCount = useAppSelector(selectSelectedAssetsCount);
  const assetsWithActiveFilters = useAppSelector(selectAssetsWithActiveFilters);
  const assetsWithActiveFiltersCount = useAppSelector(
    selectAssetsWithActiveFiltersCount,
  );
  const allImages = useAppSelector(selectAllImages);
  const allSubfolders = useAppSelector(selectAllSubfolders);
  const ioState = useAppSelector(selectIoState);
  const projectInfo = useAppSelector(selectProjectInfo);

  const hasSelectedAssets = selectedAssetsCount > 0;

  // Resolve effective asset IDs based on scoping (same pattern as add-tags-modal)
  const resolvedAssetIds = useMemo(() => {
    if (hasSelectedAssets && hasActiveFilters) {
      if (applyToSelectedAssets && applyToAssetsWithActiveFilters) {
        // Intersection
        const filteredIds = new Set(
          assetsWithActiveFilters.map((a) => a.fileId),
        );
        return selectedAssets.filter((id) => filteredIds.has(id));
      } else if (applyToSelectedAssets) {
        return [...selectedAssets];
      } else if (applyToAssetsWithActiveFilters) {
        return assetsWithActiveFilters.map((a) => a.fileId);
      }
      return [];
    } else if (hasSelectedAssets) {
      return [...selectedAssets];
    } else if (hasActiveFilters) {
      return assetsWithActiveFilters.map((a) => a.fileId);
    }
    return [];
  }, [
    hasSelectedAssets,
    hasActiveFilters,
    applyToSelectedAssets,
    applyToAssetsWithActiveFilters,
    selectedAssets,
    assetsWithActiveFilters,
  ]);

  const imageIndex = useMemo(
    () => new Map(allImages.map((img) => [img.fileId, img])),
    [allImages],
  );

  // Compute source folder summary from resolved assets
  const sourceFolderSummary = useMemo(() => {
    const folderCounts: Record<string, number> = {};

    for (const id of resolvedAssetIds) {
      const asset = imageIndex.get(id);
      if (!asset) continue;
      const folder = asset.subfolder ?? DESTINATION_ROOT;
      folderCounts[folder] = (folderCounts[folder] || 0) + 1;
    }
    return folderCounts;
  }, [resolvedAssetIds, imageIndex]);

  const sourceFolderCount = Object.keys(sourceFolderSummary).length;

  // Total assets per folder, for comparison against the scoped counts above
  const folderTotals = useMemo(() => {
    const totals: Record<string, number> = {};

    for (const img of allImages) {
      const folder = img.subfolder ?? DESTINATION_ROOT;
      totals[folder] = (totals[folder] || 0) + 1;
    }
    return totals;
  }, [allImages]);

  const rootAssetCount = folderTotals[DESTINATION_ROOT] ?? 0;

  // Build folder options for the radio list
  const folderOptions = useMemo(() => {
    const options: Array<{
      value: string;
      label: string;
      count: number;
      isSource: boolean;
      /** Every scoped asset already lives here, and nothing else does. */
      isCurrent: boolean;
      disabled: boolean;
    }> = [];

    // A folder holding every scoped asset can be renamed rather than moved to,
    // but only when the scope covers the whole folder — moving a subset would
    // split it in two, which is what the new folder option is for.
    const isRenameable = (folder: string) =>
      resolvedAssetIds.length > 0 &&
      sourceFolderSummary[folder] === resolvedAssetIds.length &&
      sourceFolderSummary[folder] === folderTotals[folder];

    // Root option — the project folder itself is never renameable
    options.push({
      value: DESTINATION_ROOT,
      label: projectInfo.projectFolderName ?? 'Root',
      count: rootAssetCount,
      isSource: DESTINATION_ROOT in sourceFolderSummary,
      isCurrent: false,
      disabled:
        resolvedAssetIds.length > 0 &&
        sourceFolderSummary[DESTINATION_ROOT] === resolvedAssetIds.length,
    });

    // Existing subfolder options
    const sortedFolders = Object.entries(allSubfolders).sort(([a], [b]) => {
      const parsedA = parseSubfolder(a);
      const parsedB = parseSubfolder(b);
      if (!parsedA || !parsedB) return a.localeCompare(b);
      if (parsedA.repeatCount !== parsedB.repeatCount) {
        return parsedA.repeatCount - parsedB.repeatCount;
      }
      return parsedA.label.localeCompare(parsedB.label);
    });

    for (const [folder, count] of sortedFolders) {
      const parsed = parseSubfolder(folder);
      const displayLabel = parsed
        ? `${parsed.repeatCount}\u00d7 ${parsed.label}`
        : folder;

      const isCurrent = isRenameable(folder);

      options.push({
        value: folder,
        label: displayLabel,
        count,
        isSource: folder in sourceFolderSummary,
        isCurrent,
        // Holding every scoped asset only blocks the option when the folder
        // can't be renamed instead
        disabled:
          !isCurrent &&
          resolvedAssetIds.length > 0 &&
          sourceFolderSummary[folder] === resolvedAssetIds.length,
      });
    }

    return options;
  }, [
    allSubfolders,
    rootAssetCount,
    sourceFolderSummary,
    folderTotals,
    resolvedAssetIds.length,
    projectInfo.projectFolderName,
  ]);

  // Archiving is a selected-assets-only operation — the filtered scope can
  // sweep in assets the user never chose, which archive must not do.
  const isSelectedOnlyScope =
    hasSelectedAssets &&
    (!hasActiveFilters ||
      (applyToSelectedAssets && !applyToAssetsWithActiveFilters));

  // The archive is a meta destination, kept out of folderOptions so the
  // rename/count machinery never sees it
  const archiveOption = useMemo(() => {
    const archivedInScope = sourceFolderSummary[ARCHIVE_FOLDER] ?? 0;
    const disabledByScope = !isSelectedOnlyScope;
    return {
      count: folderTotals[ARCHIVE_FOLDER] ?? 0,
      isSource: archivedInScope > 0,
      disabledByScope,
      disabled:
        disabledByScope ||
        (resolvedAssetIds.length > 0 &&
          archivedInScope === resolvedAssetIds.length),
    };
  }, [
    sourceFolderSummary,
    folderTotals,
    isSelectedOnlyScope,
    resolvedAssetIds.length,
  ]);

  const isArchiveMode = selectedDestination === DESTINATION_ARCHIVE;

  // Picking the folder the assets already sit in renames it rather than moving
  // them anywhere — the move itself carries every asset across to the new name
  const isRenameMode = folderOptions.some(
    (option) => option.value === selectedDestination && option.isCurrent,
  );
  const renameTarget = isRenameMode ? selectedDestination : null;

  // Rename validation
  const renameFolderName = isRenameMode
    ? `${renameRepeatCount}_${renameLabel.trim()}`
    : '';
  const isRenameLabelValid =
    !isRenameMode ||
    (renameLabel.trim().length > 0 && LABEL_PATTERN.test(renameLabel.trim()));
  const isRenameRepeatCountValid = !isRenameMode || renameRepeatCount >= 1;
  const isRenameUnchanged =
    isRenameMode && renameFolderName === selectedDestination;
  const renameCollidesWithFolder =
    isRenameMode && !isRenameUnchanged && renameFolderName in allSubfolders;

  // Resolved destination folder name (null = root)
  const resolvedDestination = useMemo((): string | null => {
    if (selectedDestination === DESTINATION_ARCHIVE) return ARCHIVE_FOLDER;
    if (selectedDestination === DESTINATION_ROOT) return null;
    if (selectedDestination === DESTINATION_NEW) {
      if (!newLabel.trim() || newRepeatCount < 1) return null;
      return `${newRepeatCount}_${newLabel.trim()}`;
    }
    if (isRenameMode) {
      if (!renameLabel.trim() || renameRepeatCount < 1) return null;
      return renameFolderName;
    }
    return selectedDestination || null;
  }, [
    selectedDestination,
    newRepeatCount,
    newLabel,
    isRenameMode,
    renameRepeatCount,
    renameLabel,
    renameFolderName,
  ]);

  // Count assets that would actually move (not already in destination)
  const effectiveMoveCount = useMemo(() => {
    if (!resolvedDestination && selectedDestination === DESTINATION_ROOT) {
      // Moving to root
      return resolvedAssetIds.filter(
        (id) => imageIndex.get(id)?.subfolder, // only count those not already in root
      ).length;
    }
    if (!resolvedDestination) return 0;

    return resolvedAssetIds.filter(
      (id) => imageIndex.get(id)?.subfolder !== resolvedDestination,
    ).length;
  }, [resolvedAssetIds, resolvedDestination, selectedDestination, imageIndex]);

  // New folder validation
  const isNewFolderMode = selectedDestination === DESTINATION_NEW;
  const newFolderName = isNewFolderMode
    ? `${newRepeatCount}_${newLabel.trim()}`
    : '';
  const isNewLabelValid =
    !isNewFolderMode ||
    (newLabel.trim().length > 0 && LABEL_PATTERN.test(newLabel.trim()));
  const isNewRepeatCountValid = !isNewFolderMode || newRepeatCount >= 1;
  const newFolderAlreadyExists =
    isNewFolderMode && newFolderName in allSubfolders;

  // Check if current destination is disabled
  const isSelectedDestinationDisabled = useMemo(() => {
    if (!selectedDestination) return true;
    if (selectedDestination === DESTINATION_NEW) return false;
    if (selectedDestination === DESTINATION_ARCHIVE)
      return archiveOption.disabled;
    const option = folderOptions.find((o) => o.value === selectedDestination);
    return option?.disabled ?? false;
  }, [selectedDestination, folderOptions, archiveOption.disabled]);

  // Scoping validation (same as add-tags-modal)
  const hasInvalidConstraints =
    hasSelectedAssets &&
    hasActiveFilters &&
    !applyToSelectedAssets &&
    !applyToAssetsWithActiveFilters;

  // Overall form validity
  const isFormValid =
    !hasInvalidConstraints &&
    resolvedAssetIds.length > 0 &&
    effectiveMoveCount > 0 &&
    selectedDestination !== '' &&
    !isSelectedDestinationDisabled &&
    (!isNewFolderMode || (isNewLabelValid && isNewRepeatCountValid)) &&
    (!isRenameMode ||
      (isRenameLabelValid &&
        isRenameRepeatCountValid &&
        !isRenameUnchanged &&
        !renameCollidesWithFolder)) &&
    !collisionError;

  // Is the IO state blocking?
  const isIoBlocked =
    ioState === IoState.SAVING ||
    ioState === IoState.LOADING ||
    ioState === IoState.COMPLETING;

  // Reset form when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional form reset on modal open
      setSelectedDestination('');
      setNewRepeatCount(1);
      setNewLabel('');
      setRenameRepeatCount(1);
      setRenameLabel('');
      setCollisionError(null);
      setMoveErrors(null);
      setIsMoving(false);

      setApplyToSelectedAssets(hasSelectedAssets);
      setApplyToAssetsWithActiveFilters(hasActiveFilters);
    }
  }, [isOpen, hasSelectedAssets, hasActiveFilters]);

  // Seed and repair the destination selection. Nothing chosen — or a choice the
  // scope has since disabled — falls back to renaming the folder the assets are
  // already in, or to a new folder when that folder isn't renameable.
  useEffect(() => {
    if (!isOpen || selectedDestination === DESTINATION_NEW) return;
    // A valid archive choice survives; a scope-disabled one falls through to
    // the fallback below
    if (selectedDestination === DESTINATION_ARCHIVE && !archiveOption.disabled)
      return;

    const selected = folderOptions.find((o) => o.value === selectedDestination);
    if (selected && !selected.disabled) return;

    const renameable = folderOptions.find((o) => o.isCurrent);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional default when no valid destination is selected
    setSelectedDestination(renameable ? renameable.value : DESTINATION_NEW);
  }, [isOpen, folderOptions, selectedDestination, archiveOption.disabled]);

  // Seed the rename fields from the folder being renamed
  useEffect(() => {
    if (!renameTarget) return;

    const parsed = parseSubfolder(renameTarget);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional form seed when the rename target changes
    setRenameRepeatCount(parsed?.repeatCount ?? 1);
    setRenameLabel(parsed?.label ?? renameTarget);
  }, [renameTarget]);

  // Clear collision error when destination changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional error reset when destination selection changes
    setCollisionError(null);
    setMoveErrors(null);
  }, [
    selectedDestination,
    newRepeatCount,
    newLabel,
    renameRepeatCount,
    renameLabel,
  ]);

  const handleSubmit = useCallback(async () => {
    if (!isFormValid || isMoving) return;

    setIsMoving(true);
    setCollisionError(null);
    setMoveErrors(null);

    try {
      const dest =
        selectedDestination === DESTINATION_ARCHIVE
          ? ARCHIVE_FOLDER
          : selectedDestination === DESTINATION_ROOT
            ? null
            : selectedDestination === DESTINATION_NEW
              ? `${newRepeatCount}_${newLabel.trim()}`
              : isRenameMode
                ? renameFolderName
                : selectedDestination;

      const result = await dispatch(
        moveAssetsToFolderThunk({
          assetIds: resolvedAssetIds,
          destination: dest,
          projectPath: projectInfo.projectPath,
        }),
      ).unwrap();

      if (result.collisions.length > 0) {
        setCollisionError(result.collisions);
      } else if (result.errors.length > 0) {
        // Partial failure — some moved, some didn't
        setMoveErrors(result.errors);
      } else if (result.moved.length > 0) {
        if (!keepSelection && hasSelectedAssets) {
          dispatch(clearSelection());
        }
        onClose();
      }
    } catch {
      // Thunk rejected — error toast already dispatched
    } finally {
      setIsMoving(false);
    }
  }, [
    isFormValid,
    isMoving,
    dispatch,
    selectedDestination,
    newRepeatCount,
    newLabel,
    isRenameMode,
    renameFolderName,
    resolvedAssetIds,
    projectInfo.projectPath,
    keepSelection,
    hasSelectedAssets,
    onClose,
  ]);

  // Summary message
  const getSummaryMessage = useCallback(() => {
    const count = resolvedAssetIds.length;
    if (count === 0) return '';

    const assetWord = count === 1 ? 'asset' : 'assets';
    const folderWord = sourceFolderCount === 1 ? 'folder' : 'folders';

    if (isRenameMode) {
      return `Renaming ${selectedDestination} — all ${count} ${assetWord} in it move to the new name.`;
    }

    if (isArchiveMode) {
      if (effectiveMoveCount === 0) {
        return `All assets are already archived.`;
      }
      if (effectiveMoveCount < count) {
        return `${effectiveMoveCount} of ${count} ${assetWord} will be archived (${count - effectiveMoveCount} already archived).`;
      }
      return `${count} ${assetWord} will be archived. Empty folders will be deleted.`;
    }

    // A half-typed new folder isn't a destination yet, so the counts below
    // would read as "nothing to move" rather than "nothing chosen"
    const hasDestination =
      selectedDestination === DESTINATION_ROOT || resolvedDestination !== null;

    if (hasDestination && effectiveMoveCount === 0) {
      return `All assets are already in the selected destination.`;
    }
    if (hasDestination && effectiveMoveCount < count) {
      return `${effectiveMoveCount} of ${count} ${assetWord} will be moved (${count - effectiveMoveCount} already in destination).`;
    }
    return `${count} ${assetWord} from ${sourceFolderCount} ${folderWord} will be moved. Empty folders will be deleted.`;
  }, [
    resolvedAssetIds.length,
    sourceFolderCount,
    effectiveMoveCount,
    isRenameMode,
    isArchiveMode,
    selectedDestination,
    resolvedDestination,
  ]);

  return {
    // Scoping
    hasActiveFilters,
    assetsWithActiveFiltersCount,
    selectedAssetsCount,
    hasSelectedAssets,
    applyToSelectedAssets,
    setApplyToSelectedAssets,
    applyToAssetsWithActiveFilters,
    setApplyToAssetsWithActiveFilters,
    hasInvalidConstraints,

    // Destination
    selectedDestination,
    setSelectedDestination,
    folderOptions,
    archiveOption,
    isArchiveMode,
    isNewFolderMode,
    newRepeatCount,
    setNewRepeatCount,
    newLabel,
    setNewLabel,
    newFolderName,
    newFolderAlreadyExists,
    isNewLabelValid,
    isNewRepeatCountValid,

    // Rename
    isRenameMode,
    renameRepeatCount,
    setRenameRepeatCount,
    renameLabel,
    setRenameLabel,
    renameFolderName,
    isRenameLabelValid,
    isRenameRepeatCountValid,
    isRenameUnchanged,
    renameCollidesWithFolder,

    // Selection
    keepSelection,
    setKeepSelection,

    // State
    isMoving,
    isIoBlocked,
    collisionError,
    moveErrors,
    effectiveMoveCount,

    // Validation
    isFormValid,

    // Actions
    handleSubmit,
    getSummaryMessage,

    // Constants for destination values
    DESTINATION_ROOT,
    DESTINATION_NEW,
    DESTINATION_ARCHIVE,
  };
};
