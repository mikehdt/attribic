import { getCategoryAnchorId } from '@/app/tagging/utils/category-utils';
import { scrollToAnchor } from '@/app/tagging/utils/scroll-to-anchor';

type CategoryHeaderProps = {
  category: string;
  visible: boolean;
};

/**
 * Sticky category header shared by the list and grid renderers. When headers
 * are hidden (single category) it still emits the anchor target so
 * cross-page category navigation keeps working.
 */
export const CategoryHeader = ({ category, visible }: CategoryHeaderProps) => {
  const anchorId = getCategoryAnchorId(category);

  if (!visible) {
    return <div id={anchorId} className="scroll-mt-24" />;
  }

  return (
    <div
      id={anchorId}
      data-category-header
      className="sticky top-24 z-10 -mx-2 cursor-pointer scroll-mt-24 rounded-sm border-b border-b-slate-700/80 bg-slate-500/60 px-4 py-1 text-sm font-medium text-white backdrop-blur-md transition-colors text-shadow-slate-700 text-shadow-xs hover:bg-slate-600/70 dark:bg-slate-600/60"
      onClick={() => scrollToAnchor(anchorId)}
      title="Click to scroll to top of this section"
    >
      {category}
    </div>
  );
};
