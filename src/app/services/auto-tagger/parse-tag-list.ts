/**
 * Parse a VLM response that was prompted for a comma-separated tag list into
 * clean tag names. Defensive about the ways models drift off-format: newline-
 * separated lists, bullet or numbered lists, wrapping quotes, stray markdown
 * emphasis and trailing full stops all reduce to the intended tags. Commas are
 * the one thing that can't appear inside a tag (they'd split it on the next
 * load), so splitting on them is always safe.
 */
export function parseTagListOutput(text: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];

  for (const raw of text.split(/[,\n]/)) {
    const tag = raw
      .replace(/^[\s\-–—•*>]+/, '')
      .replace(/^\d+[.)]\s*/, '')
      .replace(/[*`]+/g, '')
      .replace(/^["']+|["']+$/g, '')
      .replace(/[.\s]+$/, '')
      .trim();
    if (!tag) continue;

    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }

  return tags;
}
