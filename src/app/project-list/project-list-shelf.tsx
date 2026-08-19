'use client';

import { Checkbox } from '@/app/shared/checkbox';
import { GlobalMenu } from '@/app/shared/global-menu';
import { ShelfInfoRow, TopShelfFrame } from '@/app/shared/shelf';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import { selectShowHidden, setShowHidden } from '@/app/store/project-list';

import { ProjectsFolderButton } from './projects-folder-button';

/**
 * Top shelf for the start page. Global menu on the left; controls that affect
 * the page's own lists on the right. The training workbench link lives on the
 * Training Projects column heading, next to the list it belongs to.
 */
export const ProjectListShelf = () => {
  const dispatch = useAppDispatch();
  const showHidden = useAppSelector(selectShowHidden);

  return (
    <TopShelfFrame>
      <ShelfInfoRow>
        <div className="mr-auto flex">
          <GlobalMenu />
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            isSelected={showHidden}
            onChange={() => dispatch(setShowHidden(!showHidden))}
            label="Show hidden projects"
            size="sm"
          />

          <ProjectsFolderButton />
        </div>
      </ShelfInfoRow>
    </TopShelfFrame>
  );
};
