import { FileMinusIcon, FilePlusIcon } from 'lucide-react';
import { useCallback } from 'react';

import { Button } from '@/app/shared/button';
import { markFilterTagsToDelete } from '@/app/store/assets';
import { selectFilterTagsDeleteState } from '@/app/store/assets/selectors';
import { selectFilterTags } from '@/app/store/filters';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import {
  selectDeleteToggleAffectedCount,
  selectEffectiveScopeAssetIds,
} from '@/app/store/selection/combinedSelectors';

import { DocumentMixedIcon } from './document-mixed-icon';

export const DeleteToggleButton = () => {
  const dispatch = useAppDispatch();

  const filterTags = useAppSelector(selectFilterTags);
  const filterTagsDeleteState = useAppSelector(selectFilterTagsDeleteState);
  const effectiveScopeAssetIds = useAppSelector(selectEffectiveScopeAssetIds);
  const deleteToggleAffectedCount = useAppSelector(
    selectDeleteToggleAffectedCount,
  );

  const toggleFilterTagsDelete = useCallback(() => {
    dispatch(
      markFilterTagsToDelete({
        tags: filterTags,
        assetIds: effectiveScopeAssetIds,
      }),
    );
  }, [dispatch, filterTags, effectiveScopeAssetIds]);

  return (
    <Button
      type="button"
      variant="ghost"
      color="rose"
      size="toolbar"
      onClick={toggleFilterTagsDelete}
      disabled={!filterTags.length || deleteToggleAffectedCount === 0}
      title={
        filterTagsDeleteState.state === 'all'
          ? `Remove TO_DELETE state from selected tags on ${deleteToggleAffectedCount} assets`
          : filterTagsDeleteState.state === 'mixed'
            ? `Mixed state - toggle deletion on ${deleteToggleAffectedCount} assets`
            : `Mark selected tags for deletion on ${deleteToggleAffectedCount} assets`
      }
    >
      {filterTagsDeleteState.state === 'all' ? (
        <FilePlusIcon />
      ) : filterTagsDeleteState.state === 'mixed' ? (
        <DocumentMixedIcon />
      ) : (
        <FileMinusIcon />
      )}
      {filterTags.length > 0 && deleteToggleAffectedCount > 0 && (
        <span className="ml-1 text-xs">{deleteToggleAffectedCount}</span>
      )}
    </Button>
  );
};
