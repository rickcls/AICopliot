import type { Citation, Confidence, ModelAnswer } from "@/lib/schemas";
import { REFUSAL_TEXT, type SourceMap } from "./prompt";

/**
 * Citation validation — the second grounding guard.
 *
 * The model may only cite labels that were actually supplied. Anything else is
 * dropped rather than shown. If a substantive answer survives with no valid
 * citation at all, it is downgraded to a refusal: an uncitable claim is exactly
 * the shape a hallucination takes, so we refuse instead of rendering it.
 *
 * Pure and dependency-free so it is directly unit testable.
 */

export interface ValidatedAnswer {
  answer: string;
  confidence: Confidence;
  citations: Citation[];
  refused: boolean;
  /** Labels the model produced that did not correspond to a supplied source. */
  droppedSourceIds: string[];
}

const MAX_EXCERPT = 320;

/** Prefer the model's quote when it is genuinely from the chunk; else the head of the chunk. */
function buildExcerpt(quote: string, content: string): string {
  const cleanedQuote = quote.trim();
  if (cleanedQuote && content.includes(cleanedQuote)) {
    return cleanedQuote.slice(0, MAX_EXCERPT);
  }
  const head = content.trim().slice(0, MAX_EXCERPT);
  return content.trim().length > MAX_EXCERPT ? `${head}…` : head;
}

export function validateAnswer(
  model: ModelAnswer,
  sourceMap: SourceMap,
): ValidatedAnswer {
  const citations: Citation[] = [];
  const droppedSourceIds: string[] = [];
  const seen = new Set<string>();

  for (const citation of model.citations) {
    const label = citation.sourceId.trim().toUpperCase();
    const chunk = sourceMap.get(label);

    if (!chunk) {
      // The model named a source it was never given.
      droppedSourceIds.push(citation.sourceId);
      continue;
    }
    if (seen.has(chunk.id)) continue;
    seen.add(chunk.id);

    citations.push({
      chunkId: chunk.id,
      documentId: chunk.documentId,
      filename: chunk.filename,
      pageNumber: chunk.pageNumber,
      sectionTitle: chunk.sectionTitle,
      excerpt: buildExcerpt(citation.quote, chunk.content),
      score: chunk.score,
      matchType: chunk.matchType,
    });
  }

  // The model itself reported it lacked context.
  if (model.insufficientContext) {
    return {
      answer: REFUSAL_TEXT,
      confidence: "low",
      citations: [],
      refused: true,
      droppedSourceIds,
    };
  }

  // A substantive answer with nothing valid to back it is treated as unsupported.
  if (citations.length === 0) {
    return {
      answer: REFUSAL_TEXT,
      confidence: "low",
      citations: [],
      refused: true,
      droppedSourceIds,
    };
  }

  return {
    answer: model.answer,
    confidence: model.confidence,
    citations,
    refused: false,
    droppedSourceIds,
  };
}

/** The canonical refusal, used when retrieval alone is too weak to call the LLM. */
export function refusal(): ValidatedAnswer {
  return {
    answer: REFUSAL_TEXT,
    confidence: "low",
    citations: [],
    refused: true,
    droppedSourceIds: [],
  };
}
