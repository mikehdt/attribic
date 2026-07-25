'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useToast } from '@/app/shared/toast';
import {
  closeAssetImport,
  selectAssetPickRequestId,
  selectIsAssetImportOpen,
} from '@/app/store/asset-import';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';

import {
  dataTransferHasFiles,
  type DroppedFile,
  filesFromInput,
  readDroppedFiles,
} from './read-dropped-files';

export const useAssetImportHost = () => {
  const dispatch = useAppDispatch();
  const pathname = usePathname();
  const pickRequestId = useAppSelector(selectAssetPickRequestId);
  const isRequestedOpen = useAppSelector(selectIsAssetImportOpen);
  const { showToast } = useToast();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [candidates, setCandidates] = useState<DroppedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // dragenter/dragleave fire per element as the pointer crosses the page, so a
  // depth count is what distinguishes "left a child" from "left the window".
  const dragDepth = useRef(0);

  const isTagging = pathname.startsWith('/tagging');

  // Open either because something was gathered, or because the project menu
  // asked for the importer with its own drop zone.
  const isOpen = isRequestedOpen || candidates.length > 0;

  const handleClose = useCallback(() => {
    dispatch(closeAssetImport());
    setCandidates([]);
  }, [dispatch]);

  const handleChooseFiles = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFilesSelected = useCallback((files: FileList | null) => {
    // Replaced, not added to: the picker shows the full selection each time, so
    // what came back is what the user means to import.
    if (files?.length) setCandidates(filesFromInput(files));
    // Cleared so picking the same files again still fires a change event.
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  // Opening the picker from elsewhere in the app: the input lives here, next to
  // the drop handling, so both routes end up in the same place.
  const lastHandledPick = useRef(pickRequestId);
  useEffect(() => {
    if (pickRequestId === lastHandledPick.current) return;
    lastHandledPick.current = pickRequestId;
    fileInputRef.current?.click();
  }, [pickRequestId]);

  const handleDrop = useCallback(
    async (dataTransfer: DataTransfer) => {
      const files = await readDroppedFiles(dataTransfer);
      if (!files.length) {
        showToast('Nothing to import — that drop contained no files.');
        return;
      }
      // Added to whatever is already pending rather than replacing it: a second
      // drop while the summary is up means "these as well", and silently
      // discarding the first eighty files would be a nasty surprise.
      setCandidates((current) => {
        const seen = new Set(current.map((file) => file.relativePath));
        return [
          ...current,
          ...files.filter((file) => !seen.has(file.relativePath)),
        ];
      });
    },
    [showToast],
  );

  useEffect(() => {
    if (!isTagging) return;

    const onDragEnter = (e: DragEvent) => {
      if (!dataTransferHasFiles(e.dataTransfer)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setIsDragging(true);
    };

    const onDragOver = (e: DragEvent) => {
      if (!dataTransferHasFiles(e.dataTransfer)) return;
      // Without preventDefault the browser navigates to the dropped file,
      // which would throw away any unsaved tag edits.
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };

    const onDragLeave = (e: DragEvent) => {
      if (!dataTransferHasFiles(e.dataTransfer)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setIsDragging(false);
    };

    const onDrop = (e: DragEvent) => {
      if (!dataTransferHasFiles(e.dataTransfer)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setIsDragging(false);
      if (e.dataTransfer) void handleDrop(e.dataTransfer);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);

    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      dragDepth.current = 0;
    };
  }, [isTagging, handleDrop]);

  return {
    isTagging,
    isOpen,
    isDragging,
    candidates,
    fileInputRef,
    handleFilesSelected,
    handleChooseFiles,
    handleClose,
  };
};
