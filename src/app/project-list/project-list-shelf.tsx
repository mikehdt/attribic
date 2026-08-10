'use client';

import { FolderPlusIcon, GpuIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@/app/shared/button';
import { Checkbox } from '@/app/shared/checkbox';
import { GlobalMenu } from '@/app/shared/global-menu';
import { ShelfInfoRow, TopShelfFrame } from '@/app/shared/shelf';
import { ToolbarDivider } from '@/app/shared/toolbar-divider';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import {
  selectShowHidden,
  setNewProjectOpen,
  setShowHidden,
} from '@/app/store/project-list';

import { ProjectsFolderButton } from './projects-folder-button';

/**
 * Top shelf for the start page. Navigation on the left (global menu, training
 * workbench); controls that affect the page's own lists on the right.
 */
export const ProjectListShelf = () => {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const showHidden = useAppSelector(selectShowHidden);

  return (
    <TopShelfFrame>
      <ShelfInfoRow>
        <GlobalMenu />

        <ToolbarDivider />

        <div className="mr-auto flex">
          <Button
            size="xs"
            width="md"
            variant="ghost"
            onClick={() => router.push('/training')}
          >
            <GpuIcon /> LoRA Training
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            isSelected={showHidden}
            onChange={() => dispatch(setShowHidden(!showHidden))}
            label="Show hidden projects"
            size="sm"
          />

          <ProjectsFolderButton />

          <Button
            size="xs"
            width="md"
            color="sky"
            onClick={() => dispatch(setNewProjectOpen(true))}
          >
            <FolderPlusIcon />
            New Tagging Project
          </Button>
        </div>
      </ShelfInfoRow>
    </TopShelfFrame>
  );
};
