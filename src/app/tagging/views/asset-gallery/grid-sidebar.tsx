import { ImageIcon } from 'lucide-react';

import { useAppSelector } from '@/app/store/hooks';
import { selectCurrentAssetId } from '@/app/store/selection';

/**
 * Reserved inspector column for the grid view. The outer div is an in-flow
 * spacer that reserves the column's width; the inner panel is fixed so it can
 * never scroll off between the shelves — with no left/right offsets a fixed
 * element keeps its static horizontal position, so it stays aligned with the
 * spacer at every viewport width. Content taller than the gap scrolls
 * internally.
 *
 * Placeholder content for now — the real inspector (image preview, tag
 * editor, metadata) lands in the next pass.
 */
export const GridSidebar = () => {
  const currentAssetId = useAppSelector(selectCurrentAssetId);

  return (
    <div className="w-90 shrink-0 max-lg:hidden">
      <div className="fixed top-24 bottom-14 flex w-90 flex-col overflow-y-auto rounded-lg border border-(--border) bg-slate-50 p-4 dark:bg-slate-900">
        {currentAssetId ? (
          <>
            <h2 className="text-sm font-medium break-all text-slate-700 dark:text-slate-300">
              {currentAssetId}
            </h2>
            <p className="mt-3 text-sm text-slate-500">
              Inspector panel coming soon — this will hold the image preview,
              tag editor and metadata for the current asset.
            </p>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-slate-400 dark:text-slate-500">
            <ImageIcon className="h-10 w-10" />
            <p className="text-sm">
              Click an image to inspect it, or use the arrow keys to navigate.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
