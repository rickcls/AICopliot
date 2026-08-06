import { splitLabelRefs, type Inline } from "./citation-labels";

/**
 * A deliberately small renderer for one specific kind of text: the `answer`
 * string of `modelAnswerSchema`, produced under a prompt that says "be concise
 * and operational, preserve exact commands, paths and values verbatim". That is
 * paragraphs, `-`/`1.` lists, `**bold**`, backticked paths and the odd fence —
 * not the tables, footnotes and raw HTML a general markdown library carries 40
 * transitive packages to support.
 *
 * Two things make a general parser the wrong tool here rather than merely a
 * heavier one:
 *
 * - The combined-scope prompt mandates the *bare* headings "Document
 *   requirements" and "Current project state" (rule 5, enforced in
 *   rag/citations.ts). They are not `##`, so a markdown parser renders them as
 *   paragraphs. Recognising them is a project rule, not a markdown rule.
 * - Inline `[S1]` references have to become chips, which means splitting text
 *   nodes and interleaving components either way.
 *
 * It returns data, never markup, so React escapes every string and there is no
 * `dangerouslySetInnerHTML` and no sanitiser in the path.
 */

export type { Inline };

export type AnswerBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; inlines: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "code"; value: string };

/** The headings PROJECT_SYSTEM_PROMPT requires when an answer spans both families. */
const MANDATED_HEADINGS = ["Document requirements", "Current project state"];

const ATX_HEADING = /^#{1,6}\s+(.*)$/;
const UNORDERED_ITEM = /^\s*[-*]\s+(.*)$/;
const ORDERED_ITEM = /^\s*\d{1,3}[.)]\s+(.*)$/;
const FENCE = /^\s*```/;

/** Strips the `**…**` a model often wraps a heading in before comparing. */
function headingText(line: string): string | null {
  const atx = ATX_HEADING.exec(line);
  if (atx) return atx[1].trim();

  const bare = line
    .trim()
    .replace(/^\*\*(.*)\*\*$/, "$1")
    .replace(/:$/, "")
    .trim();
  // Whole-line comparison, so the same words inside a sentence stay prose.
  return MANDATED_HEADINGS.includes(bare) ? bare : null;
}

const INLINE_TOKEN = /`([^`]+)`|\*\*([^*]+)\*\*/g;

function parseInlines(text: string, knownLabels: ReadonlySet<string>): Inline[] {
  const inlines: Inline[] = [];
  let cursor = 0;

  for (const match of text.matchAll(INLINE_TOKEN)) {
    inlines.push(...splitLabelRefs(text.slice(cursor, match.index), knownLabels));
    // A backticked path or command is preserved exactly, labels and all.
    if (match[1] !== undefined) inlines.push({ type: "code", value: match[1] });
    else inlines.push({ type: "strong", value: match[2] });
    cursor = match.index + match[0].length;
  }

  inlines.push(...splitLabelRefs(text.slice(cursor), knownLabels));
  return inlines.filter((inline) => inline.type !== "text" || inline.value !== "");
}

export function parseAnswer(
  text: string,
  knownLabels: readonly string[] = [],
): AnswerBlock[] {
  const labels = new Set(knownLabels);
  const lines = text.split("\n");
  const blocks: AnswerBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    if (FENCE.test(line)) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // the closing fence, or the end of the text
      blocks.push({ type: "code", value: body.join("\n") });
      continue;
    }

    const heading = headingText(line);
    if (heading !== null) {
      blocks.push({ type: "heading", text: heading });
      i += 1;
      continue;
    }

    const ordered = ORDERED_ITEM.test(line);
    if (ordered || UNORDERED_ITEM.test(line)) {
      const pattern = ordered ? ORDERED_ITEM : UNORDERED_ITEM;
      const items: Inline[][] = [];
      while (i < lines.length) {
        const item = pattern.exec(lines[i]);
        if (!item) break;
        items.push(parseInlines(item[1], labels));
        i += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    // Everything up to the next blank line or structural line is one paragraph,
    // joined with spaces the way markdown treats a soft wrap.
    const paragraph: string[] = [];
    while (i < lines.length) {
      const next = lines[i];
      if (
        next.trim() === "" ||
        FENCE.test(next) ||
        headingText(next) !== null ||
        UNORDERED_ITEM.test(next) ||
        ORDERED_ITEM.test(next)
      ) {
        break;
      }
      paragraph.push(next.trim());
      i += 1;
    }
    blocks.push({ type: "paragraph", inlines: parseInlines(paragraph.join(" "), labels) });
  }

  return blocks;
}
