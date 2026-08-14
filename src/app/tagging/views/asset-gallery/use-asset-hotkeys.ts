import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { useToast } from '@/app/shared/toast';
import {
  selectAssetById,
  selectFilteredAssets,
  selectFirstTaglessFilteredAsset,
} from '@/app/store/assets';
import { moveAssetsToFolderThunk } from '@/app/store/assets/actions';
import { selectPaginationSize } from '@/app/store/filters';
import { useAppDispatch, useAppSelector, useAppStore } from '@/app/store/hooks';
import { selectProjectInfo } from '@/app/store/project';
import {
  selectCurrentAssetId,
  selectWorkingSelection,
  setCurrentAsset,
} from '@/app/store/selection';
import {
  ARCHIVE_FOLDER,
  isArchiveSubfolder,
} from '@/app/utils/subfolder-utils';

import {
  GALLERY_EDITOR_SELECTOR,
  isNavContextBlocked,
  scrollAssetIntoView,
} from './use-asset-keyboard-nav';

const isChord = (e: KeyboardEvent): boolean =>
  e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;

const isArchiveChord = (e: KeyboardEvent): boolean =>
  isChord(e) && (e.key === 'Delete' || e.key === 'Backspace');

const isJumpToUntaggedChord = (e: KeyboardEvent): boolean =>
  isChord(e) && e.key.toLowerCase() === 'u';

// Asset id awaiting a scroll once its page has rendered. Module-level, not a
// ref: changing the page segment remounts the whole gallery, and the pending
// scroll has to survive that remount to fire on the destination page.
let pendingScrollAssetId: string | null = null;

/**
 * View-agnostic hotkeys acting on the current asset, mounted once by the
 * gallery. Deliberately modifier chords, never bare letters: if focus is
 * silently lost mid-edit, stray typing must not trigger destructive actions.
 *
 * - Ctrl+Delete (or Ctrl+Backspace) toggles archive on the working selection —
 *   a move to `.archive`, or back to the project root. That's everything
 *   ticked plus the highlighted asset, and the highlight sets the direction.
 *   When the move takes the highlighted asset out of the filtered view
 *   (archiving under "hide archived", unarchiving under "archived only"), the
 *   highlight advances to the nearest survivor so a culling pass never loses
 *   its place.
 * - Ctrl+U jumps to the first untagged asset in filtered order, changing
 *   page when it lives on another one.
 *
 * Same inertness rules as the nav layer: inputs, editing surfaces and open
 * dialogs own their keys.
 */
export const useAssetHotkeys = (
  orderedAssetIds: string[],
  currentPage: number,
) => {
  const dispatch = useAppDispatch();
  const store = useAppStore();
  const router = useRouter();
  const params = useParams();
  const { showErrorToast } = useToast();
  const currentAssetId = useAppSelector(selectCurrentAssetId);
  const projectPath = useAppSelector(selectProjectInfo).projectPath;

  // Matches the pagination base path built in StableLayout
  const project = params.project as string | undefined;
  const basePath = project
    ? `/tagging/${encodeURIComponent(project)}`
    : '/tagging';

  useEffect(() => {
    const pending = pendingScrollAssetId;
    if (!pending || !orderedAssetIds.includes(pending)) return;
    pendingScrollAssetId = null;
    // After paint, so it wins over the new page's scroll-to-top
    requestAnimationFrame(() => scrollAssetIntoView(pending));
  }, [orderedAssetIds]);

  // Refs so the window listener binds once and always sees fresh values
  const currentRef = useRef(currentAssetId);
  const idsRef = useRef(orderedAssetIds);
  const projectPathRef = useRef(projectPath);
  // Guards against key-repeat re-firing while a move is in flight
  const moveInFlightRef = useRef(false);

  useEffect(() => {
    currentRef.current = currentAssetId;
  }, [currentAssetId]);

  useEffect(() => {
    idsRef.current = orderedAssetIds;
  }, [orderedAssetIds]);

  useEffect(() => {
    projectPathRef.current = projectPath;
  }, [projectPath]);

  useEffect(() => {
    const toggleArchive = async (assetId: string) => {
      const state = store.getState();
      const asset = selectAssetById(state, assetId);
      if (!asset) return;

      // The highlighted asset sets the direction; the scope is the working
      // selection, so this acts on everything ticked plus the highlighted
      // asset itself — the highlight is a soft selection, never a scope of its
      // own. Targets already on the destination side are dropped, so a mixed
      // selection archives what isn't archived yet instead of bouncing files
      // against the folder they're already in.
      const archiving = !isArchiveSubfolder(asset.subfolder);
      const destination = archiving ? ARCHIVE_FOLDER : null;

      const targets = selectWorkingSelection(state).filter((id) => {
        const target = selectAssetById(state, id);
        return !!target && isArchiveSubfolder(target.subfolder) !== archiving;
      });
      if (targets.length === 0) return;

      // Computed before the move: these ids are untouched by it, so they
      // stay valid even though the moved assets' own ids get remapped
      const ids = idsRef.current;
      const moving = new Set(targets);
      const index = ids.indexOf(assetId);
      const stays = (id: string) => !moving.has(id);
      const successor =
        index === -1
          ? null
          : (ids.slice(index + 1).find(stays) ??
            ids.slice(0, index).findLast(stays) ??
            null);

      moveInFlightRef.current = true;
      try {
        const result = await dispatch(
          moveAssetsToFolderThunk({
            assetIds: targets,
            destination,
            projectPath: projectPathRef.current,
          }),
        ).unwrap();

        if (result.collisions.length > 0) {
          const subject =
            result.collisions.length === 1
              ? 'an asset with the same name is'
              : 'assets with the same name are';
          showErrorToast(
            archiving
              ? `Couldn’t archive — ${subject} already in the archive`
              : `Couldn’t unarchive — ${subject} already in the project root`,
          );
          return;
        }
        if (result.errors.length > 0) {
          showErrorToast(result.errors[0]);
          return;
        }

        // The selection slice has remapped the current id to its new
        // location; if the move took the asset out of the filtered view
        // (visibility mode hides it now), advance to the neighbour
        const state = store.getState();
        const movedCurrentId = selectCurrentAssetId(state);
        const stillVisible =
          !!movedCurrentId &&
          selectFilteredAssets(state).some((a) => a.fileId === movedCurrentId);
        if (!stillVisible) {
          dispatch(setCurrentAsset(successor));
          if (successor) scrollAssetIntoView(successor);
        }
      } catch (error) {
        showErrorToast(
          error instanceof Error ? error.message : 'Failed to move asset',
        );
      } finally {
        moveInFlightRef.current = false;
      }
    };

    const jumpToFirstUntagged = () => {
      const state = store.getState();
      const target = selectFirstTaglessFilteredAsset(state);
      if (!target) return;

      dispatch(setCurrentAsset(target.fileId));

      const paginationSize = selectPaginationSize(state);
      const targetPage =
        paginationSize === -1
          ? 1
          : Math.floor(target.index / paginationSize) + 1;
      if (targetPage === currentPage) {
        scrollAssetIntoView(target.fileId);
      } else {
        pendingScrollAssetId = target.fileId;
        // scroll: false keeps the router's own scroll-to-top from landing
        // after (and overriding) the pending scroll to the target asset
        router.push(`${basePath}/${targetPage}`, { scroll: false });
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const isJump = isJumpToUntaggedChord(e);
      if (!isJump && !isArchiveChord(e)) return;
      if (isNavContextBlocked(e, GALLERY_EDITOR_SELECTOR)) return;

      if (isJump) {
        e.preventDefault();
        jumpToFirstUntagged();
        return;
      }

      const current = currentRef.current;
      if (!current || moveInFlightRef.current) return;

      e.preventDefault();
      void toggleArchive(current);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dispatch, store, router, basePath, showErrorToast, currentPage]);
};
