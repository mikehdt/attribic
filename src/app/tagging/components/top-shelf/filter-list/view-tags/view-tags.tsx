import { XIcon } from 'lucide-react';

import { highlightText } from '@/app/tagging/utils/text-highlight';

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
      {/* Search input section */}
      <div className="relative shrink-0 border-b border-slate-200 bg-slate-50 px-2 py-2 dark:border-slate-700 dark:bg-slate-800">
        <input
          ref={inputRef}
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
          placeholder="Search tags..."
          className="w-full rounded-full border border-slate-300 bg-white py-1 ps-4 pe-8 inset-shadow-sm inset-shadow-slate-200 transition-all dark:border-slate-600 dark:bg-slate-700 dark:inset-shadow-slate-800"
        />
        <button
          className={`absolute top-3 right-4 h-5 w-5 rounded-full p-0.5 transition-colors ${
            searchTerm.trim() !== ''
              ? 'cursor-pointer text-slate-600 hover:bg-slate-500 hover:text-white dark:text-slate-400 dark:hover:bg-slate-600'
              : 'pointer-events-none text-white dark:text-slate-700'
          }`}
          onClick={
            searchTerm.trim() !== '' ? () => setSearchTerm('') : undefined
          }
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>

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
                  id={`tag-${item.tag}`}
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
