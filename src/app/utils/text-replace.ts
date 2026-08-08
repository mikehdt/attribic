import { HYBRID_DELIMITER } from '@/app/store/assets/hybrid-caption';

export type TagUpdate = {
  oldTagName: string;
  newTagName: string;
  operation: 'RENAME' | 'DELETE';
};

export type InvalidTagResult = {
  tag: string;
  result: string;
  reason: 'comma' | 'hybrid-delimiter';
};

export type MatchRange = { start: number; end: number };

const escapeRegexLiteral = (pattern: string): string =>
  pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Compile a search pattern into a global RegExp, or report why it can't be.
 * Literal mode escapes the pattern so every character matches itself.
 */
export const compileSearch = (
  pattern: string,
  useRegex: boolean,
  matchCase: boolean,
): { regex: RegExp | null; error: string | null } => {
  if (!pattern) {
    return { regex: null, error: null };
  }

  const source = useRegex ? pattern : escapeRegexLiteral(pattern);
  const flags = matchCase ? 'g' : 'gi';

  try {
    return { regex: new RegExp(source, flags), error: null };
  } catch (e) {
    return {
      regex: null,
      error: e instanceof Error ? e.message : 'Invalid regular expression',
    };
  }
};

/**
 * Prepare a replacement string for String.replace. In literal mode `$` must be
 * escaped to `$$` so it can't act as a capture-group reference; in regex mode
 * `$1` etc. are passed through deliberately.
 */
export const prepareReplacement = (
  replacement: string,
  useRegex: boolean,
): string => (useRegex ? replacement : replacement.replaceAll('$', '$$$$'));

export const replaceText = (
  text: string,
  regex: RegExp,
  preparedReplacement: string,
): string => {
  regex.lastIndex = 0;
  return text.replace(regex, preparedReplacement);
};

/**
 * All match positions in text, for highlighting. Zero-length matches (e.g.
 * from `a*`) are skipped — they replace fine but there's nothing to highlight.
 */
export const getMatchRanges = (text: string, regex: RegExp): MatchRange[] => {
  regex.lastIndex = 0;
  const ranges: MatchRange[] = [];
  for (const match of text.matchAll(regex)) {
    if (match[0].length === 0) continue;
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
};

/**
 * Compile a search/replace over whole tags into rename/delete operations for
 * `editTagsAcrossAssets`. A tag whose replacement result is empty becomes a
 * DELETE; unchanged tags are skipped.
 *
 * Results that would corrupt the tag list are excluded and reported instead:
 * commas would split into multiple tags on the next load, and a bare `__`
 * would act as the hybrid tags/caption delimiter.
 */
export const buildTagUpdates = (
  tags: string[],
  regex: RegExp,
  preparedReplacement: string,
): { updates: TagUpdate[]; invalid: InvalidTagResult[] } => {
  const updates: TagUpdate[] = [];
  const invalid: InvalidTagResult[] = [];

  tags.forEach((tag) => {
    const result = replaceText(tag, regex, preparedReplacement).trim();

    if (result === tag) return;

    if (result === '') {
      updates.push({ oldTagName: tag, newTagName: '', operation: 'DELETE' });
      return;
    }

    if (result.includes(',')) {
      invalid.push({ tag, result, reason: 'comma' });
      return;
    }

    if (result === HYBRID_DELIMITER) {
      invalid.push({ tag, result, reason: 'hybrid-delimiter' });
      return;
    }

    updates.push({ oldTagName: tag, newTagName: result, operation: 'RENAME' });
  });

  return { updates, invalid };
};
