import { memo } from 'react';

import { DropdownButton } from '@/app/shared/dropdown';

import { useVisibilityControl } from './use-visibility-control';
import { VisibilityPanel } from './visibility-panel';

const VisibilityControlComponent = () => {
  const { activeCount } = useVisibilityControl();
  const isActive = activeCount > 0;

  return (
    <DropdownButton
      title="Visibility settings"
      menuClassName="w-64"
      label={
        <>
          <span className="text-nowrap">Filter Assets</span>
          {isActive && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-sky-500 px-1 text-xs font-bold text-white tabular-nums">
              {activeCount}
            </span>
          )}
        </>
      }
    >
      <VisibilityPanel />
    </DropdownButton>
  );
};

export const VisibilityControl = memo(VisibilityControlComponent);
