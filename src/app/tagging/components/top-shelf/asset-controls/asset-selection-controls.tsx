import { IdCardIcon } from 'lucide-react';
import { memo } from 'react';

import { ResponsiveToolbarGroup } from '@/app/shared/responsive-toolbar-group';
import { ToolbarDivider } from '@/app/shared/toolbar-divider';

import { ViewModeToggle } from '../view-mode-toggle';
import { AssetSortControls } from './asset-sort-controls';
import { ClearFiltersButton } from './clear-filters-button';
import { ClearSelectionButton } from './clear-selection-button';
import { ClearSelectionsButton } from './clear-selections-button';
import { MoveToFolderButton } from './move-to-folder-button';
import { SelectAllButton } from './select-all-button';
import { VisibilityControl } from './visibility-control/visibility-control';

const AssetSelectionControlsComponent = () => {
  return (
    <ResponsiveToolbarGroup
      icon={<IdCardIcon className="h-4 w-4" />}
      title="Assets"
      position="left"
      breakpoint="lg"
    >
      <ViewModeToggle />

      <ToolbarDivider />

      <VisibilityControl />

      <span className="mx-0.5 cursor-default text-xs text-slate-500 max-xl:hidden">
        by
      </span>
      <AssetSortControls />

      <ToolbarDivider />

      <ClearFiltersButton />
      <ClearSelectionsButton />

      <ToolbarDivider />

      <SelectAllButton />
      <ClearSelectionButton />

      <ToolbarDivider />

      <MoveToFolderButton />
    </ResponsiveToolbarGroup>
  );
};

export const AssetSelectionControls = memo(AssetSelectionControlsComponent);
