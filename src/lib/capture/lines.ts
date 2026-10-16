/**
 * Splits a capture into short labelled lines, C1..Cn.
 *
 * Labels are what the model cites, so they are opaque and assigned here —
 * never an id, never something the model chose (invariant 3). Lines are short
 * so a citation points at the sentence that justifies a proposal rather than
 * at the whole note: one line per newline, then per sentence. Dictated
 * Cantonese often has no punctuation at all, so a long run is hard-split, at a
 * space or comma where there is one.
 */

export interface CaptureLine {
  label: string;
  text: string;
}

export const MAX_CAPTURE_LINES = 150;
export const MAX_LINE_CHARS = 300;

/** Sentence ends: Chinese full-width marks, and Latin ones followed by a space. */
const SENTENCE_END = /(?<=[。！？；])|(?<=[.!?;])\s+/u;

function hardSplit(text: string, max: number): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const breakAt = Math.max(
      window.lastIndexOf(" "),
      window.lastIndexOf("，"),
      window.lastIndexOf(","),
      window.lastIndexOf("、"),
    );
    const cut = breakAt > max / 2 ? breakAt + 1 : max;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

export function splitCaptureLines(
  text: string,
  { maxLines = MAX_CAPTURE_LINES, maxLineChars = MAX_LINE_CHARS } = {},
): { lines: CaptureLine[]; truncated: boolean } {
  const pieces = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .flatMap((line) => line.split(SENTENCE_END))
    .map((piece) => piece.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .flatMap((piece) => hardSplit(piece, maxLineChars));

  const kept = pieces.slice(0, maxLines);
  return {
    lines: kept.map((line, index) => ({ label: `C${index + 1}`, text: line })),
    truncated: pieces.length > maxLines,
  };
}

/** The block handed to the model: one `[C1] text` per line. */
export function buildCaptureBlock(lines: CaptureLine[]): string {
  return lines.map((line) => `[${line.label}] ${line.text}`).join("\n");
}

/**
 * The text of the cited lines and their immediate neighbours. A date phrase is
 * checked against this rather than the cited line alone, because a hard split
 * can land between "下星期" and "五".
 */
export function citedNeighbourhood(lines: CaptureLine[], labels: string[]): string {
  const indexes = new Set<number>();
  for (const label of labels) {
    const index = lines.findIndex((line) => line.label === label);
    if (index === -1) continue;
    for (const near of [index - 1, index, index + 1]) {
      if (near >= 0 && near < lines.length) indexes.add(near);
    }
  }
  return [...indexes]
    .sort((a, b) => a - b)
    .map((index) => lines[index].text)
    .join("");
}
