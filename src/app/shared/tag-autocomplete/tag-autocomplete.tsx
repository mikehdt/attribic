'use client';

import { useState } from 'react';

import { DROPDOWN_MENU_CLASS } from '../dropdown/dropdown-styles';
import { Popup } from '../popup';
import { highlightText } from '../text-highlight';
import type { TagAutocompleteControl } from './use-tag-autocomplete';

type TagAutocompleteProps = {
  control: TagAutocompleteControl;
};

/**
 * Floating suggestion list for tag inputs — visually a Dropdown menu without
 * the trigger button. Anchored to the input via the shared Popup system, so it
 * portals above modals, flips when out of viewport room, follows the input on
 * scroll, and closes if the input scrolls out of view. Matched text is bolded
 * and each row shows the tag's project-wide count, echoing the filter menu.
 *
 * Render alongside the input whose useTagAutocomplete produced the control.
 */
export const TagAutocomplete = ({ control }: TagAutocompleteProps) => {
  const {
    popupId,
    listboxId,
    anchorRef,
    anchorWidth,
    suggestions,
    query,
    highlightedIndex,
    getOptionId,
    onItemSelect,
    onItemHover,
    onListMouseLeave,
  } = control;

  // During the close animation the live list may already be empty (the host
  // clears the input on select) — keep showing the last real suggestions so
  // the popup doesn't collapse to an empty box while fading out. Derived
  // state adjusted during render (not a ref/effect) per the React pattern
  // for retaining a previous value.
  const [lastSuggestions, setLastSuggestions] = useState(suggestions);
  if (suggestions.length > 0 && suggestions !== lastSuggestions) {
    setLastSuggestions(suggestions);
  }
  const visible = suggestions.length > 0 ? suggestions : lastSuggestions;

  return (
    <Popup
      id={popupId}
      position="bottom-left"
      triggerRef={anchorRef}
      style={anchorWidth > 0 ? { minWidth: anchorWidth } : undefined}
      // max-w caps growth from long tags / caption-ish phrasing; min-width
      // wins over max-width in CSS, so wide anchors (modal inputs) still get
      // a list matching their full width
      className={`${DROPDOWN_MENU_CLASS} max-w-sm overflow-hidden`}
    >
      <ul
        id={listboxId}
        role="listbox"
        aria-label="Tag suggestions"
        className="divide-y divide-slate-100 dark:divide-slate-800"
        onMouseLeave={onListMouseLeave}
      >
        {visible.map((suggestion, index) => (
          <li
            key={suggestion.tag}
            id={getOptionId(index)}
            role="option"
            aria-selected={index === highlightedIndex}
            // Swallow mousedown so clicking a suggestion doesn't blur the
            // input — a blur would cancel edits and close the list pre-click
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => onItemSelect(index, e.shiftKey)}
            onMouseMove={() => onItemHover(index)}
            className={`flex cursor-pointer items-center justify-between gap-5 px-4 py-2 ${
              index === highlightedIndex ? 'bg-blue-50 dark:bg-slate-700' : ''
            }`}
          >
            <span
              className="min-w-0 truncate text-slate-800 dark:text-slate-200"
              title={suggestion.tag}
            >
              {highlightText(suggestion.tag, query)}
            </span>
            <span className="shrink-0 text-sm text-slate-500 tabular-nums dark:text-slate-400">
              {suggestion.count}
            </span>
          </li>
        ))}
      </ul>
    </Popup>
  );
};
