import { RotateCcwIcon } from 'lucide-react';
import { useCallback } from 'react';

type FieldResetButtonProps = {
  onClick: () => void;
  className?: string;
};

/**
 * Subtle per-field reset affordance — sits next to a field's title and is
 * only rendered when the field's value differs from its model default (see
 * `FieldTitle`, which owns that comparison). Deliberately quieter than
 * `SectionResetButton`: no label, just a small icon.
 */
export const FieldResetButton = ({
  onClick,
  className = '',
}: FieldResetButtonProps) => {
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      onClick();
    },
    [onClick],
  );

  return (
    <button
      type="button"
      onClick={handleClick}
      title="Reset to default"
      aria-label="Reset to default"
      className={`cursor-pointer rounded text-slate-400 hover:text-sky-500 dark:text-slate-500 dark:hover:text-sky-400 ${className}`}
    >
      <RotateCcwIcon className="h-3 w-3" />
    </button>
  );
};
