import { BookmarkCheckIcon, BookmarkXIcon } from 'lucide-react';

import { Button } from '@/app/shared/button';
import {
  resetAllModifiedTags,
  saveAllAssets,
  selectHasModifiedAssets,
} from '@/app/store/assets';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import { selectProjectFolderName } from '@/app/store/project';

export const IoActions = ({ ioInProgress }: { ioInProgress: boolean }) => {
  const dispatch = useAppDispatch();

  const hasModifiedAssets = useAppSelector(selectHasModifiedAssets);
  const projectFolderName = useAppSelector(selectProjectFolderName);

  const saveAllChanges = () => {
    dispatch(saveAllAssets({ projectPath: projectFolderName || undefined }));
  };
  const discardAllChanges = () => dispatch(resetAllModifiedTags());

  return (
    <>
      <Button
        type="button"
        size="md"
        width="lg"
        ghostDisabled
        onClick={discardAllChanges}
        disabled={!hasModifiedAssets || ioInProgress}
        title={
          hasModifiedAssets
            ? 'Discard all tag changes (Ctrl+Shift+D)'
            : 'No changes to discard'
        }
      >
        <BookmarkXIcon />
        <span className="max-lg:hidden">Discard All</span>
      </Button>

      <Button
        type="button"
        size="md"
        width="lg"
        color="teal"
        ghostDisabled
        neutralDisabled
        onClick={saveAllChanges}
        disabled={!hasModifiedAssets || ioInProgress}
        title={
          hasModifiedAssets
            ? 'Save all tag changes (Ctrl+Shift+S)'
            : 'No changes to save'
        }
      >
        <BookmarkCheckIcon />
        <span className="max-lg:hidden">Save All</span>
      </Button>
    </>
  );
};
