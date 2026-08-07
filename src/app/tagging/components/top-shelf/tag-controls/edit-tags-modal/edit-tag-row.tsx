'use client';

import { useCallback, useMemo, useRef } from 'react';

import { TagAutocomplete } from '@/app/shared/tag-autocomplete/tag-autocomplete';
import { useTagAutocomplete } from '@/app/shared/tag-autocomplete/use-tag-autocomplete';

type EditTagRowProps = {
  tag: string;
  value: string;
  inputClassName: string;
  tooltip: string;
  onChange: (tag: string, value: string) => void;
};

/**
 * One rename row: original tag → editable new name with tag autocomplete.
 * Selecting a suggestion fills the field rather than committing — the modal
 * commits everything on Save Changes, and the duplicate-status colouring
 * reacts to the filled value like any typed input. Only the row's own tag is
 * excluded from suggestions; renaming onto an existing tag is a deliberate
 * merge here, surfaced by the status highlights.
 */
export const EditTagRow = ({
  tag,
  value,
  inputClassName,
  tooltip,
  onChange,
}: EditTagRowProps) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const exclude = useMemo(() => [tag], [tag]);

  const handleSuggestionSelect = useCallback(
    (selected: string) => onChange(tag, selected),
    [onChange, tag],
  );

  const {
    handleKeyDown: suggestionsKeyDown,
    handleFocus: suggestionsFocus,
    handleBlur: suggestionsBlur,
    inputProps: suggestionsInputProps,
    control: suggestionsControl,
  } = useTagAutocomplete({
    query: value,
    exclude,
    onSelect: handleSuggestionSelect,
    anchorRef: inputRef,
  });

  return (
    <div className="flex w-full items-center">
      {/* Original tag */}
      <div className="relative w-1/2 truncate pr-10 font-medium text-slate-500 dark:text-slate-400">
        {tag}
        <div className="absolute top-0 right-0 w-10 text-center text-slate-700 dark:text-slate-500">
          -&gt;
        </div>
      </div>

      {/* Edit field */}
      <div className="relative flex-1">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(tag, e.target.value)}
          // With a highlighted suggestion Enter fills the field (consumed);
          // otherwise it falls through to the form's implicit submission
          onKeyDown={(e) => suggestionsKeyDown(e)}
          onFocus={suggestionsFocus}
          onBlur={suggestionsBlur}
          className={`w-full rounded-full border px-4 py-1 inset-shadow-sm focus:outline ${inputClassName}`}
          placeholder="New tag name"
          title={tooltip}
          aria-label={`Rename tag ${tag}`}
          {...suggestionsInputProps}
        />

        <TagAutocomplete control={suggestionsControl} />
      </div>
    </div>
  );
};
