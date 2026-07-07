import { useEffect } from 'react';

import { GlobalMenu } from '@/app/shared/global-menu';
import {
  ShelfInfoRow,
  ShelfToolbarRow,
  TopShelfFrame,
} from '@/app/shared/shelf';
import { ToolbarDivider } from '@/app/shared/toolbar-divider';
import { resetFilterModeIfNeeded } from '@/app/store/filters';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import { selectSelectedAssetsCount } from '@/app/store/selection';

import { AssetSelectionControls } from './asset-controls/asset-selection-controls';
import { CategoryNavigation } from './category-navigation/category-navigation';
import { FilterListButton } from './filter-list/filter-list-button';
import { AssetCounts } from './info/asset-counts';
import { FilterIndicatorsInfo } from './info/filter-counts';
import { ProjectMenu } from './info/project-menu';
import { TagActions } from './tag-controls/tag-actions';

type TaggingTopShelfProps = {
  currentPage?: number;
};

export const TaggingTopShelf = ({ currentPage = 1 }: TaggingTopShelfProps) => {
  const dispatch = useAppDispatch();

  const selectedAssetsCount = useAppSelector(selectSelectedAssetsCount);

  // Effect to reset filter mode when selected assets are cleared
  useEffect(() => {
    dispatch(
      resetFilterModeIfNeeded({ hasSelectedAssets: selectedAssetsCount > 0 }),
    );
  }, [selectedAssetsCount, dispatch]);

  return (
    <TopShelfFrame>
      <ShelfInfoRow>
        <GlobalMenu />

        <ToolbarDivider />

        <ProjectMenu />

        <ToolbarDivider />

        <div className="mr-auto!">
          <AssetCounts />
        </div>

        <FilterIndicatorsInfo />
      </ShelfInfoRow>

      <ShelfToolbarRow>
        <CategoryNavigation currentPage={currentPage} />

        <div className="mr-auto!">
          <AssetSelectionControls />
        </div>

        <TagActions />

        <FilterListButton />
      </ShelfToolbarRow>
    </TopShelfFrame>
  );
};
