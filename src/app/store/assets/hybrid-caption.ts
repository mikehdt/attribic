/**
 * Hybrid caption format — imageboard-style tags followed by a natural-language caption
 * in a single `.txt` file, used by models like Anima that mix both.
 *
 * On-disk shape:
 *
 *   1girl, solo, red hair, outdoors, __, A woman with red hair in a sunlit field.
 *   └──────────── tags ────────────┘  ↑   └──────────── caption ─────────────┘
 *                                     delimiter token
 *
 * The delimiter is the token `__` sitting on its own between `, ` separators.
 * It's chosen so that:
 *   - A naive `, `-splitter (how most taggers, and this app, tokenise) yields
 *     `__` as a single junk "tag" that's trivially dropped — everything after
 *     it is the caption.
 *   - It can never collide with a real booru tag: tags use *single* underscores
 *     as space substitutes (`long_hair`), so a bare `__` never occurs as a tag.
 *
 * All knowledge of the format lives here so there's exactly one place to change
 * if the delimiter ever needs to move.
 */

/** The delimiter token, as it appears as its own comma-delimited entry. */
export const HYBRID_DELIMITER = '__';

/** The composed separator inserted between the tag block and the caption. */
const HYBRID_SEPARATOR = `, ${HYBRID_DELIMITER}, `;

/**
 * Whether a string carries a standalone `__` delimiter token, i.e. it is
 * already in hybrid shape and {@link splitHybrid} will recover both sides of it.
 */
export function hasHybridDelimiter(raw: string): boolean {
  return raw.split(', ').some((part) => part.trim() === HYBRID_DELIMITER);
}

/**
 * Parse a raw hybrid `.txt` string into its tag list and caption.
 *
 * Splits on the *first* `__` delimiter token only, so a stray `__` inside the
 * caption body is left untouched. If no delimiter is present, the whole string
 * is treated as tags with an empty caption (a hybrid file that hasn't had a
 * caption added yet).
 */
export function splitHybrid(raw: string): { tags: string[]; caption: string } {
  const parts = raw.split(', ');

  // Find the first standalone `__` token — that's the boundary.
  const delimiterIndex = parts.findIndex(
    (part) => part.trim() === HYBRID_DELIMITER,
  );

  if (delimiterIndex === -1) {
    // No caption section — everything is tags.
    return {
      tags: parts.map((t) => t.trim()).filter((t) => t !== ''),
      caption: '',
    };
  }

  const tags = parts
    .slice(0, delimiterIndex)
    .map((t) => t.trim())
    .filter((t) => t !== '');

  // Rejoin the tail with the original `, ` so commas inside the caption survive.
  const caption = parts
    .slice(delimiterIndex + 1)
    .join(', ')
    .trim();

  return { tags, caption };
}

/**
 * Compose a tag list and caption into the hybrid on-disk string.
 *
 * The delimiter + caption are only appended when the caption is non-empty, so a
 * hybrid asset with no caption yet writes a clean tags-only file (which still
 * round-trips back to an empty caption via {@link splitHybrid}).
 */
export function joinHybrid(tags: string[], caption: string): string {
  const tagBlock = tags.join(', ');
  const trimmedCaption = caption.trim();

  if (!trimmedCaption) {
    return tagBlock;
  }

  if (!tagBlock) {
    // Caption but no tags — still emit the marker so it re-parses as hybrid.
    return `${HYBRID_DELIMITER}, ${trimmedCaption}`;
  }

  return `${tagBlock}${HYBRID_SEPARATOR}${trimmedCaption}`;
}
