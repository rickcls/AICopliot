import "server-only";
import Papa from "papaparse";
import type { SupportedKind } from "./validate-upload";

/**
 * A unit of extracted text with whatever positional metadata the format offers.
 * PDFs give real page numbers; DOCX and Markdown give headings; plain text
 * gives neither. The chunker propagates whatever is present.
 */
export interface ExtractedSection {
  text: string;
  pageNumber: number | null;
  sectionTitle: string | null;
}

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

/** Splits markdown-ish text into sections keyed by the most recent heading. */
function splitByMarkdownHeadings(text: string): ExtractedSection[] {
  const lines = text.split(/\r?\n/);
  const sections: ExtractedSection[] = [];
  let currentTitle: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const body = buffer.join("\n").trim();
    if (body) {
      sections.push({ text: body, pageNumber: null, sectionTitle: currentTitle });
    }
    buffer = [];
  };

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      currentTitle = heading[2].trim() || null;
      // Keep the heading in the body so its wording is searchable.
      buffer.push(heading[2].trim());
    } else {
      buffer.push(line);
    }
  }
  flush();

  return sections.length > 0
    ? sections
    : [{ text: text.trim(), pageNumber: null, sectionTitle: null }];
}

async function extractPdf(buffer: Buffer): Promise<ExtractedSection[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  // mergePages: false keeps the per-page split, which is what gives citations
  // a real page number.
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];

  return pages
    .map((pageText, i) => ({
      text: (pageText ?? "").trim(),
      pageNumber: i + 1,
      sectionTitle: null,
    }))
    .filter((s) => s.text.length > 0);
}

function decodeEntities(html: string): string {
  return html
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * Splits mammoth's HTML on heading tags so each section carries the heading it
 * sits under. Block-level tags become newlines so paragraph structure survives
 * for the chunker's breakpoint search.
 */
function splitHtmlByHeadings(html: string): ExtractedSection[] {
  const parts = html.split(/(<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>)/i);
  const sections: ExtractedSection[] = [];
  let currentTitle: string | null = null;

  for (const part of parts) {
    if (!part.trim()) continue;

    const heading = /^<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>$/i.exec(part);
    if (heading) {
      currentTitle = stripTags(heading[1]) || null;
      // Keep the heading text in the body so its wording stays searchable.
      if (currentTitle) {
        sections.push({
          text: currentTitle,
          pageNumber: null,
          sectionTitle: currentTitle,
        });
      }
      continue;
    }

    const text = decodeEntities(
      part
        .replace(/<\/(p|div|li|tr|table|blockquote)>/gi, "\n\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, ""),
    )
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (text) {
      sections.push({ text, pageNumber: null, sectionTitle: currentTitle });
    }
  }

  return sections;
}

async function extractDocx(buffer: Buffer): Promise<ExtractedSection[]> {
  const mammoth = (await import("mammoth")).default;
  // HTML preserves heading levels, which become sectionTitle for citations.
  const { value } = await mammoth.convertToHtml({ buffer });
  const sections = splitHtmlByHeadings(value);
  return sections.length > 0
    ? sections
    : [{ text: stripTags(value), pageNumber: null, sectionTitle: null }];
}

function extractCsv(buffer: Buffer): ExtractedSection[] {
  const raw = buffer.toString("utf8");
  const parsed = Papa.parse<string[]>(raw.trim(), { skipEmptyLines: true });

  const rows = parsed.data.filter((r) => Array.isArray(r) && r.length > 0);
  if (rows.length === 0) return [];

  const header = rows[0].join(" | ");
  const body = rows.slice(1);
  if (body.length === 0) {
    return [{ text: header, pageNumber: null, sectionTitle: null }];
  }

  // Group rows into sections and repeat the header in each, so a chunk taken
  // from the middle of a large CSV is still interpretable on its own.
  const ROWS_PER_SECTION = 40;
  const sections: ExtractedSection[] = [];
  for (let i = 0; i < body.length; i += ROWS_PER_SECTION) {
    const slice = body.slice(i, i + ROWS_PER_SECTION);
    sections.push({
      text: [header, ...slice.map((r) => r.join(" | "))].join("\n"),
      pageNumber: null,
      sectionTitle: `Rows ${i + 1}–${i + slice.length}`,
    });
  }
  return sections;
}

export async function extractText(
  buffer: Buffer,
  kind: SupportedKind,
): Promise<ExtractedSection[]> {
  let sections: ExtractedSection[];

  try {
    switch (kind) {
      case "pdf":
        sections = await extractPdf(buffer);
        break;
      case "docx":
        sections = await extractDocx(buffer);
        break;
      case "markdown":
        sections = splitByMarkdownHeadings(buffer.toString("utf8"));
        break;
      case "csv":
        sections = extractCsv(buffer);
        break;
      case "text":
        sections = [
          {
            text: buffer.toString("utf8").trim(),
            pageNumber: null,
            sectionTitle: null,
          },
        ];
        break;
    }
  } catch (cause) {
    throw new ExtractionError(
      `Could not read the ${kind.toUpperCase()} file: ${(cause as Error).message}`,
    );
  }

  const nonEmpty = sections.filter((s) => s.text.trim().length > 0);
  if (nonEmpty.length === 0) {
    throw new ExtractionError(
      "No readable text found. Scanned or image-only documents are not supported in this version.",
    );
  }

  return nonEmpty;
}
