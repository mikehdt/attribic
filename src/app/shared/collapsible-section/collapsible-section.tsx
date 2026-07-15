import { ChevronDownIcon } from 'lucide-react';
import { memo, type ReactNode, useCallback, useState } from 'react';

type CollapsibleSectionProps = {
  title: string;
  defaultExpanded?: boolean;
  /** Content rendered inline after the title (e.g. status dots, badges) */
  headerExtra?: ReactNode;
  /** Actions rendered before the chevron; receives expanded state for conditional visibility */
  headerActions?: ReactNode | ((expanded: boolean) => ReactNode);
  children: ReactNode;
};

const CollapsibleSectionComponent = ({
  title,
  defaultExpanded = true,
  headerExtra,
  headerActions,
  children,
}: CollapsibleSectionProps) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const handleToggle = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const actions =
    typeof headerActions === 'function'
      ? headerActions(isExpanded)
      : headerActions;

  return (
    <div className="overflow-hidden rounded-lg border border-(--border)">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onClick={handleToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleToggle();
          }
        }}
        className="flex w-full cursor-pointer items-center justify-between bg-(--surface) px-4 py-2 text-sm inset-shadow-sm inset-shadow-white dark:inset-shadow-slate-700"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-base font-medium text-(--foreground)">{title}</h3>
          {headerExtra}
        </div>

        <div className="flex items-center gap-1">
          {actions}
          <ChevronDownIcon
            className={`my-1 ml-2 h-4 w-4 text-(--unselected-text) transition-transform ${
              isExpanded ? 'rotate-180' : ''
            }`}
          />
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-(--border) bg-slate-50 px-4 py-3 dark:bg-slate-900">
          {children}
        </div>
      )}
    </div>
  );
};

export const CollapsibleSection = memo(CollapsibleSectionComponent);
