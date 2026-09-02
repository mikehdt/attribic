const WORD_CHAR = /[\p{L}\p{N}_]/u;

const isWordChar = (char: string | undefined): boolean =>
  !!char && WORD_CHAR.test(char);

/**
 * Next whole-word occurrence of `phrase` at or after `from`, or -1.
 *
 * The boundary check is per-edge and only applies where the phrase's own edge
 * is a word character, mirroring `\b`: "hi" misses "this" and "hit" but hits
 * "oh, hi!", while a phrase like ":sks:" stays matchable mid-word.
 *
 * Callers lowercase both arguments themselves when matching case-insensitively.
 */
const nextPhraseMatch = (
  text: string,
  phrase: string,
  from: number,
): number => {
  let index = text.indexOf(phrase, from);

  while (index !== -1) {
    const startsAtBoundary =
      !isWordChar(phrase[0]) || !isWordChar(text[index - 1]);
    const endsAtBoundary =
      !isWordChar(phrase[phrase.length - 1]) ||
      !isWordChar(text[index + phrase.length]);

    if (startsAtBoundary && endsAtBoundary) return index;
    index = text.indexOf(phrase, index + 1);
  }

  return -1;
};

export const containsPhrase = (text: string, phrase: string): boolean =>
  !!phrase && nextPhraseMatch(text, phrase, 0) !== -1;

/** Start index of every whole-word occurrence of `phrase` in `text`. */
export const findPhraseMatches = (text: string, phrase: string): number[] => {
  if (!phrase) return [];

  const starts: number[] = [];
  let index = nextPhraseMatch(text, phrase, 0);

  while (index !== -1) {
    starts.push(index);
    index = nextPhraseMatch(text, phrase, index + 1);
  }

  return starts;
};
