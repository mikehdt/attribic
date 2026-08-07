import React, { Fragment } from 'react';

/**
 * Highlights matching segments of text by wrapping them in bold tags
 * @param text - The text to highlight
 * @param searchQuery - The search query to highlight
 * @param normalize - Optional function to normalize text for matching (applied to both text and query)
 * @returns Array of React elements with highlighted matches
 */
export const highlightText = (
  text: string,
  searchQuery: string,
  normalize?: (text: string) => string,
): React.ReactNode => {
  if (!searchQuery || searchQuery.trim() === '') {
    return text;
  }

  const query = searchQuery.trim();

  // Apply normalization if provided
  const normalizedQuery = normalize
    ? normalize(query.toLowerCase())
    : query.toLowerCase();
  const normalizedText = normalize
    ? normalize(text.toLowerCase())
    : text.toLowerCase();

  // If no matches, return text
  if (!normalizedText.includes(normalizedQuery)) {
    return text;
  }

  const result = [];
  let lastIndex = 0;

  // Find all occurrences of the search term
  let index = normalizedText.indexOf(normalizedQuery);

  while (index !== -1) {
    // Add the text before the match
    if (index > lastIndex) {
      result.push(
        <Fragment key={`text-${lastIndex}`}>
          {text.substring(lastIndex, index)}
        </Fragment>,
      );
    }

    // Add the highlighted match
    result.push(
      <span key={`match-${index}`} className="font-bold">
        {text.substring(index, index + query.length)}
      </span>,
    );

    lastIndex = index + query.length;
    index = normalizedText.indexOf(normalizedQuery, lastIndex);
  }

  // Add any remaining text
  if (lastIndex < text.length) {
    result.push(
      <Fragment key={`text-${lastIndex}`}>
        {text.substring(lastIndex)}
      </Fragment>,
    );
  }

  return result;
};

type HighlightRange = { start: number; end: number };

/**
 * Computes merged, sorted highlight ranges for multiple patterns in text.
 * Pure function — no React dependency — reusable for both rendering and filtering.
 */
const computeHighlightRanges = (
  text: string,
  patterns: string[],
): HighlightRange[] => {
  if (!patterns || patterns.length === 0) return [];

  const normalizedText = text.toLowerCase();
  const ranges: HighlightRange[] = [];

  for (const pattern of patterns) {
    if (!pattern) continue;
    const normalizedPattern = pattern.toLowerCase();
    let index = normalizedText.indexOf(normalizedPattern);
    while (index !== -1) {
      ranges.push({ start: index, end: index + pattern.length });
      index = normalizedText.indexOf(normalizedPattern, index + 1);
    }
  }

  if (ranges.length === 0) return [];

  // Sort by start position
  ranges.sort((a, b) => a.start - b.start);

  // Merge overlapping ranges
  const merged: HighlightRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }

  return merged;
};

/**
 * Highlights matching segments of text for multiple patterns
 * @param text - The text to highlight
 * @param patterns - Array of patterns to highlight (case-insensitive)
 * @param highlightClassName - CSS class for highlight spans (default: font-bold)
 * @returns Array of React elements with highlighted matches
 */
export const highlightPatterns = (
  text: string,
  patterns: string[],
  highlightClassName = 'font-bold',
): React.ReactNode => {
  const ranges = computeHighlightRanges(text, patterns);

  if (ranges.length === 0) return text;

  const result: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const range of ranges) {
    if (range.start > lastIndex) {
      result.push(
        <Fragment key={`text-${lastIndex}`}>
          {text.substring(lastIndex, range.start)}
        </Fragment>,
      );
    }

    result.push(
      <span key={`match-${range.start}`} className={highlightClassName}>
        {text.substring(range.start, range.end)}
      </span>,
    );

    lastIndex = range.end;
  }

  if (lastIndex < text.length) {
    result.push(
      <Fragment key={`text-${lastIndex}`}>
        {text.substring(lastIndex)}
      </Fragment>,
    );
  }

  return result;
};

/**
 * Highlights trigger phrases in caption text with a background highlight
 * @param text - The caption text
 * @param phrases - Array of trigger phrases to highlight
 * @returns Array of React elements with highlighted trigger phrases
 */
export const highlightTriggerPhrases = (
  text: string,
  phrases: string[],
): React.ReactNode => {
  return highlightPatterns(
    text,
    phrases,
    'box-decoration-clone text-green-950 rounded-md bg-green-200/60 px-1 -mx-1 shadow-sm shadow-green-500/50 inset-shadow-xs inset-shadow-green-300/50 outline outline-green-300 dark:text-green-100 dark:outline-green-700 dark:bg-green-700/50 dark:inset-shadow-green-600/50',
  );
};
