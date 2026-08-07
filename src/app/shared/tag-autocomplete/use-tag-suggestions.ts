import { useMemo } from 'react';

import { selectTagCounts } from '@/app/store/assets';
import { useAppSelector } from '@/app/store/hooks';

export type TagSuggestion = {
  tag: string;
  /** How many assets in the project carry this tag */
  count: number;
};

export const DEFAULT_SUGGESTION_LIMIT = 5;

/**
 * Match and rank project tags against a query.
 *
 * Matching mirrors the filter panel's tag search: case-insensitive substring.
 * Ranking: prefix matches before mid-string matches, then by count descending,
 * then alphabetically.
 *
 * This is the single seam for suggestion behaviour — future app-level matching
 * options or extra sources (e.g. booru CSVs) belong here, not in the hosts.
 */
const matchTagSuggestions = (
  counts: Record<string, number>,
  query: string,
  exclude?: ReadonlySet<string>,
  limit: number = DEFAULT_SUGGESTION_LIMIT,
): TagSuggestion[] => {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const prefixMatches: TagSuggestion[] = [];
  const innerMatches: TagSuggestion[] = [];

  for (const [tag, count] of Object.entries(counts)) {
    const lower = tag.toLowerCase();
    if (exclude?.has(lower)) continue;
    const index = lower.indexOf(needle);
    if (index === -1) continue;
    (index === 0 ? prefixMatches : innerMatches).push({ tag, count });
  }

  const byCountThenName = (a: TagSuggestion, b: TagSuggestion) =>
    b.count - a.count || a.tag.localeCompare(b.tag);
  prefixMatches.sort(byCountThenName);
  innerMatches.sort(byCountThenName);

  return [...prefixMatches, ...innerMatches].slice(0, limit);
};

/**
 * Project-tag suggestions for an input's current text. `exclude` removes tags
 * that would be no-ops for the host (e.g. tags already on the asset).
 */
export const useTagSuggestions = (
  query: string,
  exclude?: string[],
  limit: number = DEFAULT_SUGGESTION_LIMIT,
): TagSuggestion[] => {
  const counts = useAppSelector(selectTagCounts);

  const excludeSet = useMemo(
    () =>
      exclude ? new Set(exclude.map((tag) => tag.toLowerCase())) : undefined,
    [exclude],
  );

  return useMemo(
    () => matchTagSuggestions(counts, query, excludeSet, limit),
    [counts, query, excludeSet, limit],
  );
};
