/**
 * A short excerpt around the first place `query` appears in `text`, matched
 * case-insensitively, with the match's position so the page can mark it.
 * Falls back to the opening of the text when the query does not appear (a
 * meaning match), so every result has something to read.
 */
export function snippetAround(
  text: string,
  query: string,
  radius = 80,
): { text: string; match: [number, number] | null } {
  const flat = text.replace(/\s+/g, " ").trim();
  const needle = query.trim().toLowerCase();
  const at = needle ? flat.toLowerCase().indexOf(needle) : -1;

  if (at === -1) {
    const opening = flat.slice(0, radius * 2);
    return { text: opening.length < flat.length ? `${opening}…` : opening, match: null };
  }

  const start = Math.max(0, at - radius);
  const end = Math.min(flat.length, at + needle.length + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < flat.length ? "…" : "";
  const offset = prefix.length + (at - start);
  return {
    text: `${prefix}${flat.slice(start, end)}${suffix}`,
    match: [offset, offset + needle.length],
  };
}
