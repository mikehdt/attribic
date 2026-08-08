import React, { memo, useCallback, useEffect, useRef, useState } from 'react';

import { highlightTriggerPhrases } from '@/app/shared/text-highlight';

/**
 * Render backdrop text with trigger phrase highlights, preserving empty lines.
 * A textarea gives height to empty lines and trailing newlines automatically,
 * but a div with whitespace-pre-wrap collapses them. We split by newline and
 * insert <br/> elements to match the textarea's rendering.
 */
function renderBackdropText(
  text: string,
  triggerPhrases: string[],
): React.ReactNode {
  const lines = text.split('\n');

  return lines.map((line, i) => (
    <React.Fragment key={i}>
      {i > 0 && '\n'}
      {line === '' ? '\u00A0' : highlightTriggerPhrases(line, triggerPhrases)}
    </React.Fragment>
  ));
}

type CaptionEditorProps = {
  captionText: string;
  triggerPhrases: string[];
  onTextChange: (text: string) => void;
};

// Debounce for committing the local draft to Redux while typing — long enough
// to skip per-keystroke dispatches, short enough for dirty tracking to feel live
const COMMIT_DEBOUNCE_MS = 300;

/**
 * Mirror/overlay caption editor.
 *
 * A transparent textarea sits over a backdrop div that renders the same text
 * with trigger-phrase highlights. Both share identical CSS so the text wraps
 * in the same positions. The textarea is mounted on hover or focus to avoid
 * having 100 textareas on the page, while still giving native cursor placement,
 * selection, copy/paste, and undo/redo.
 */
const CaptionEditorComponent = ({
  captionText,
  triggerPhrases,
  onTextChange,
}: CaptionEditorProps) => {
  const [isActive, setIsActive] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Local draft of the caption. Typing edits this and commits to Redux on
  // blur plus a short debounce — dispatching per keystroke would re-run the
  // full filter/sort pipeline for every asset on the page.
  const [draft, setDraft] = useState(captionText);
  const draftRef = useRef(captionText);
  const committedRef = useRef(captionText);
  const isFocusedRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTextChangeRef = useRef(onTextChange);
  useEffect(() => {
    onTextChangeRef.current = onTextChange;
  });

  const commitDraft = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (draftRef.current !== committedRef.current) {
      committedRef.current = draftRef.current;
      onTextChangeRef.current(draftRef.current);
    }
  }, []);

  // Resync from the store when it changes externally (auto-tagger, clear-all)
  // while the editor isn't focused; a focused editor's draft wins
  useEffect(() => {
    committedRef.current = captionText;
    if (!isFocusedRef.current) {
      draftRef.current = captionText;
      setDraft(captionText);
    }
  }, [captionText]);

  // Flush a dirty draft on unmount so page/asset changes mid-edit don't lose it
  useEffect(() => commitDraft, [commitDraft]);

  const wordCount = draft.trim() ? draft.trim().split(/\s+/).length : 0;

  // Auto-grow the textarea to fit its content
  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, []);

  // Adjust height when the textarea mounts and observe the container for
  // resizes. Deliberately excludes captionText so the observer isn't torn
  // down and recreated on every keystroke.
  useEffect(() => {
    if (!isActive) return;
    adjustHeight();

    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => adjustHeight());
    observer.observe(container);
    return () => observer.disconnect();
  }, [isActive, adjustHeight]);

  // Re-measure height whenever the caption text changes
  useEffect(() => {
    if (!isActive) return;
    adjustHeight();
  }, [draft, isActive, adjustHeight]);

  // Sync scroll position from textarea to backdrop
  const handleScroll = useCallback(() => {
    const textarea = textareaRef.current;
    const container = containerRef.current;
    if (!textarea || !container) return;
    const backdrop = container.querySelector<HTMLDivElement>(
      '[data-caption-backdrop]',
    );
    if (backdrop) {
      backdrop.scrollTop = textarea.scrollTop;
    }
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const text = e.target.value;
      draftRef.current = text;
      setDraft(text);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(commitDraft, COMMIT_DEBOUNCE_MS);
    },
    [commitDraft],
  );

  // Escape reverts the draft to the last committed store value and leaves the
  // editor — matching the tag inputs, where Escape cancels
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
          debounceRef.current = null;
        }
        draftRef.current = committedRef.current;
        setDraft(committedRef.current);
        e.currentTarget.blur();
      }
    },
    [],
  );

  const handleFocus = useCallback(() => {
    isFocusedRef.current = true;
    setIsFocused(true);
  }, []);
  const handleBlur = useCallback(() => {
    isFocusedRef.current = false;
    setIsFocused(false);
    commitDraft();
    // Deactivate if the mouse isn't over the container
    const container = containerRef.current;
    if (container && !container.matches(':hover')) {
      setIsActive(false);
    }
  }, [commitDraft]);

  // Show textarea on hover or focus, keep it while focused even if mouse leaves
  const handleMouseEnter = useCallback(() => setIsActive(true), []);
  const handleMouseLeave = useCallback(() => {
    if (!isFocused) setIsActive(false);
  }, [isFocused]);

  // Shared text styles — must be identical on backdrop and textarea. Font
  // size is deliberately unset: both layers inherit it (preflight gives the
  // textarea `font: inherit`), so a container can scale the editor — e.g. the
  // grid inspector's text-sm — without the layers drifting apart.
  const textStyles =
    'leading-relaxed whitespace-pre-wrap break-words font-[inherit]';

  return (
    <div className="flex h-full w-full flex-col">
      <div
        ref={containerRef}
        className="relative cursor-text"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* Backdrop: renders highlighted text, always visible */}
        <div
          data-caption-backdrop
          className={`rounded-md border bg-white px-2 py-1 transition-colors hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 ${textStyles} ${
            isFocused
              ? 'border-sky-300 ring-1 ring-sky-300 dark:border-sky-600 dark:ring-sky-600'
              : isActive
                ? 'border-slate-300 dark:border-slate-600'
                : 'border-slate-200 hover:border-slate-400 dark:border-slate-700 dark:hover:border-slate-600'
          }`}
        >
          {draft ? (
            renderBackdropText(draft, triggerPhrases)
          ) : isActive ? (
            // Non-breaking space keeps the backdrop at one line height when empty
            '\u00A0'
          ) : (
            <span className="text-slate-400 dark:text-slate-600">
              Click to add caption...
            </span>
          )}
        </div>

        {/* Textarea overlay: transparent text, visible caret, mounted on hover/focus */}
        {isActive && (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onScroll={handleScroll}
            className={`absolute inset-0 resize-none overflow-hidden rounded-md border border-transparent bg-transparent px-2 py-1 text-transparent caret-slate-800 outline-none select-text dark:caret-slate-200 ${textStyles}`}
            rows={1}
          />
        )}
      </div>

      <span className="mt-2 border border-transparent px-2 text-right text-sm text-slate-400 tabular-nums dark:text-slate-500">
        {wordCount} {wordCount === 1 ? 'word' : 'words'}
      </span>
    </div>
  );
};

export const CaptionEditor = memo(CaptionEditorComponent);
