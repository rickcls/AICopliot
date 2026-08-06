/**
 * Turning the model's inline `[S1]` / `(T3)` references into chips.
 *
 * Both system prompts require the model to cite opaque labels inline, so the
 * raw answer text is full of them. They only become chips when the label is one
 * this answer actually kept after citation validation — otherwise a dropped or
 * fabricated label would render as a link to a source card that does not exist.
 * That also means a thread persisted before citations carried labels degrades to
 * plain text rather than to broken links.
 */

export type Inline =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "strong"; value: string }
  | { type: "citation"; label: string };

/** `[S1]`, `(T3)`, and comma groups like `[S1, Q2]`. */
const LABEL_GROUP =
  /\[\s*([A-Z]\d{1,3}(?:\s*,\s*[A-Z]\d{1,3})*)\s*\]|\(\s*([A-Z]\d{1,3}(?:\s*,\s*[A-Z]\d{1,3})*)\s*\)/g;

function pushText(inlines: Inline[], value: string) {
  if (value.length === 0) return;
  const last = inlines.at(-1);
  if (last?.type === "text") last.value += value;
  else inlines.push({ type: "text", value });
}

export function splitLabelRefs(
  text: string,
  knownLabels: ReadonlySet<string>,
): Inline[] {
  const inlines: Inline[] = [];
  let cursor = 0;

  for (const match of text.matchAll(LABEL_GROUP)) {
    const group = match[1] ?? match[2] ?? "";
    const labels = group.split(",").map((label) => label.trim());

    // All-or-nothing: a group where any label was dropped stays literal, so the
    // reader still sees everything the model claimed rather than a quiet subset.
    if (!labels.every((label) => knownLabels.has(label))) continue;

    pushText(inlines, text.slice(cursor, match.index));
    for (const label of labels) inlines.push({ type: "citation", label });
    cursor = match.index + match[0].length;
  }

  pushText(inlines, text.slice(cursor));
  return inlines;
}
