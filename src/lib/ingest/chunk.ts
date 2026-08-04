import type { ExtractedSection } from "./extract";

/**
 * Chunking.
 *
 * Pure and dependency-free so it can be unit tested directly. The contract the
 * tests enforce:
 *   - every chunk carries the page number / section title of the section it
 *     came from,
 *   - chunkIndex is contiguous and document-global (not per-section),
 *   - consecutive chunks from the same section overlap,
 *   - no chunk exceeds maxChars, and splits never land mid-word.
 */

export interface Chunk {
  content: string;
  chunkIndex: number;
  pageNumber: number | null;
  sectionTitle: string | null;
}

export interface ChunkOptions {
  maxChars?: number;
  overlapChars?: number;
}

const DEFAULT_MAX_CHARS = 1000;
const DEFAULT_OVERLAP = 150;

/**
 * Finds a natural break at or before `limit`: paragraph, then sentence, then
 * whitespace. Returns `limit` only if the span has no break at all (e.g. one
 * enormous unbroken token), which is the sole case where a word may be split.
 */
function findBreakpoint(text: string, limit: number): number {
  const window = text.slice(0, limit);

  const paragraph = window.lastIndexOf("\n\n");
  // Ignore breaks in the first 40% — they produce uselessly short chunks.
  if (paragraph > limit * 0.4) return paragraph + 2;

  const sentence = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("! "),
    window.lastIndexOf("? "),
    window.lastIndexOf(".\n"),
  );
  if (sentence > limit * 0.4) return sentence + 1;

  const newline = window.lastIndexOf("\n");
  if (newline > limit * 0.4) return newline + 1;

  const space = window.lastIndexOf(" ");
  if (space > limit * 0.4) return space + 1;

  return limit;
}

/**
 * Rewinding by the overlap lands at an arbitrary character offset, which would
 * start the next chunk in the middle of a word. Nudge forward to the next word
 * start so every chunk begins on a whole token.
 */
function snapToWordStart(text: string, position: number): number {
  if (position <= 0 || position >= text.length) return position;
  if (/\s/.test(text[position - 1])) return position;

  const nextSpace = text.slice(position).search(/\s/);
  if (nextSpace === -1) return text.length;
  return position + nextSpace + 1;
}

function splitSection(text: string, maxChars: number, overlapChars: number): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const out: string[] = [];
  let cursor = 0;

  while (cursor < trimmed.length) {
    const remaining = trimmed.slice(cursor);

    if (remaining.length <= maxChars) {
      const tail = remaining.trim();
      if (tail) out.push(tail);
      break;
    }

    const breakAt = findBreakpoint(remaining, maxChars);
    const piece = remaining.slice(0, breakAt).trim();
    if (piece) out.push(piece);

    // Step forward by the piece length minus the overlap so consecutive chunks
    // share context. Guard against a non-advancing cursor.
    const advance = Math.max(1, breakAt - overlapChars);
    cursor = snapToWordStart(trimmed, cursor + advance);
  }

  return out;
}

export function chunkSections(
  sections: ExtractedSection[],
  options: ChunkOptions = {},
): Chunk[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = Math.min(
    options.overlapChars ?? DEFAULT_OVERLAP,
    Math.floor(maxChars / 2),
  );

  const chunks: Chunk[] = [];

  for (const section of sections) {
    for (const content of splitSection(section.text, maxChars, overlapChars)) {
      chunks.push({
        content,
        // Document-global index, assigned in reading order across all sections.
        chunkIndex: chunks.length,
        pageNumber: section.pageNumber,
        sectionTitle: section.sectionTitle,
      });
    }
  }

  return chunks;
}
