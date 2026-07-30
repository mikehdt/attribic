import { highlightText } from '@/app/tagging/utils/text-highlight';

import { FilterSearchInput } from '../filter-search-input';
import {
  RANGE_PREVIEW_DESELECT_CLASS,
  RANGE_PREVIEW_SELECT_TAGS,
} from '../use-range-toggle';
import { useTagsView } from './use-tags-view';

export const TagsView = () => {
  const {
    searchTerm,
    setSearchTerm,
    handleKeyDown,
    inputRef,
    filteredTags,
    selectedIndex,
    handleItemAction,
    previewState,
    handleItemMouseMove,
    handleListMouseLeave,
  } = useTagsView();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FilterSearchInput
        value={searchTerm}
        onChange={setSearchTerm}
        onKeyDown={handleKeyDown}
        inputRef={inputRef}
        subject="tags"
      />

      {/* Tags list */}
      {filteredTags.length === 0 ? (
        <div className="truncate p-4 text-center text-sm text-slate-500">
          {searchTerm ? `No tags match "${searchTerm}"` : 'No tags found'}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ul
            className="divide-y divide-slate-100 dark:divide-slate-700"
            onMouseLeave={handleListMouseLeave}
          >
            {filteredTags.map((item, index) => {
              const preview = previewState(item.tag);
              return (
                <li
                  // Encoded so tags with spaces/quotes still form a valid DOM id
                  id={`tag-${encodeURIComponent(item.tag)}`}
                  key={item.tag}
                  onClick={(e) => {
                    if (e.shiftKey) e.preventDefault(); // avoid text selection
                    handleItemAction(index, e.shiftKey);
                  }}
                  onMouseMove={() => handleItemMouseMove(index)}
                  className={`flex cursor-pointer items-center justify-between px-3 py-2 transition-colors select-none ${
                    preview === 'select'
                      ? RANGE_PREVIEW_SELECT_TAGS
                      : preview === 'deselect'
                        ? RANGE_PREVIEW_DESELECT_CLASS
                        : index === selectedIndex
                          ? item.isActive
                            ? 'bg-teal-300 dark:bg-teal-700'
                            : 'bg-blue-100 dark:bg-blue-900/50'
                          : item.isActive
                            ? 'bg-teal-100 dark:bg-teal-900/50'
                            : ''
                  }`}
                  title={
                    item.isActive
                      ? 'Click to remove from filters'
                      : 'Click to add to filters'
                  }
                >
                  <span
                    className={`text-sm ${
                      item.isActive
                        ? 'font-medium text-teal-700 dark:text-teal-300'
                        : 'text-slate-800 dark:text-slate-200'
                    }`}
                  >
                    {searchTerm
                      ? highlightText(item.tag, searchTerm)
                      : item.tag}
                  </span>
                  <span
                    className={`text-xs tabular-nums ${
                      item.isActive
                        ? 'text-teal-600 dark:text-teal-400'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {item.count}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};
