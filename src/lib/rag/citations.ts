import type { Citation, Confidence, ModelAnswer } from "@/lib/schemas";
import {
  buildVerifiedExcerpt,
  resolveDocumentCitations,
} from "@/lib/grounding/document-citations";
import type { ProjectGroundingSource } from "./project-context";
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

export interface CitationFamilyRequirements {
  document: boolean;
  live: boolean;
}

const DOCUMENT_INTENT = [
  "requirement",
  "scope",
  "deliverable",
  "acceptance",
  "criteria",
  "uat",
  "specification",
  "specified",
  "sop",
] as const;

const LIVE_INTENT = [
  "current",
  "health",
  "now",
  "status",
  "block",
  "dependency",
  "depend",
  "prerequisite",
  "task",
  "milestone",
  "risk",
  "due",
  "overdue",
  "assignee",
  "assigned",
  "owner",
  "progress",
  "done",
  "complete",
  "week",
  "next",
] as const;

/** Pure intent gate used to require the right citation family for mixed questions. */
export function inferCitationFamilyRequirements(
  question: string,
): CitationFamilyRequirements {
  const normalized = question.toLocaleLowerCase();
  return {
    document: DOCUMENT_INTENT.some((term) => normalized.includes(term)),
    live: LIVE_INTENT.some((term) => normalized.includes(term)),
  };
}

function isProjectSource(
  source: SourceMap extends Map<string, infer T> ? T : never,
): source is ProjectGroundingSource {
  return "kind" in source;
}

export function validateAnswer(
  model: ModelAnswer,
  sourceMap: SourceMap,
  options: {
    refusalText?: string;
    requireMixedHeadings?: boolean;
    question?: string;
    enforceIntentFamilies?: boolean;
  } = {},
): ValidatedAnswer {
  const citations: Citation[] = [];
  const resolved = resolveDocumentCitations(model.citations, sourceMap);

  for (const citation of resolved.citations) {
    const source = sourceMap.get(citation.sourceId);
    if (!source) continue;

    if (isProjectSource(source)) {
      citations.push({
        kind: source.kind,
        title: source.title,
        excerpt: buildVerifiedExcerpt(citation.excerpt, source.content),
        observedAt: source.observedAt,
        href: source.href,
        snapshot: { ...source.snapshot },
      });
    } else {
      citations.push({
        kind: "document",
        chunkId: source.id,
        documentId: source.documentId,
        filename: source.filename,
        pageNumber: source.pageNumber,
        sectionTitle: source.sectionTitle,
        excerpt: citation.excerpt,
        score: source.score,
        matchType: source.matchType,
      });
    }
  }

  const refusalText = options.refusalText ?? REFUSAL_TEXT;

  // The model itself reported it lacked context.
  if (model.insufficientContext) {
    return {
      answer: refusalText,
      confidence: "low",
      citations: [],
      refused: true,
      droppedSourceIds: resolved.droppedSourceIds,
    };
  }

  // A substantive answer with nothing valid to back it is treated as unsupported.
  if (citations.length === 0) {
    return {
      answer: refusalText,
      confidence: "low",
      citations: [],
      refused: true,
      droppedSourceIds: resolved.droppedSourceIds,
    };
  }

  const citedDocuments = citations.some((citation) => citation.kind === "document");
  const citedLiveData = citations.some((citation) => citation.kind !== "document");
  const suppliedSources = [...sourceMap.values()];
  const suppliedDocuments = suppliedSources.some(
    (source) => !isProjectSource(source),
  );
  const suppliedLiveData = suppliedSources.some(isProjectSource);
  const intent = options.question
    ? inferCitationFamilyRequirements(options.question)
    : { document: false, live: false };
  const requireDocuments =
    intent.document && (options.enforceIntentFamilies || suppliedDocuments);
  const requireLiveData =
    intent.live && (options.enforceIntentFamilies || suppliedLiveData);
  if (
    (requireDocuments && !citedDocuments) ||
    (requireLiveData && !citedLiveData)
  ) {
    return {
      answer: refusalText,
      confidence: "low",
      citations: [],
      refused: true,
      droppedSourceIds: resolved.droppedSourceIds,
    };
  }

  if (
    options.requireMixedHeadings &&
    ((requireDocuments && requireLiveData) ||
      (citedDocuments && citedLiveData)) &&
    (!model.answer.includes("Document requirements") ||
      !model.answer.includes("Current project state"))
  ) {
    return {
      answer: refusalText,
      confidence: "low",
      citations: [],
      refused: true,
      droppedSourceIds: resolved.droppedSourceIds,
    };
  }

  return {
    answer: model.answer,
    confidence: model.confidence,
    citations,
    refused: false,
    droppedSourceIds: resolved.droppedSourceIds,
  };
}

/** The canonical refusal, used when retrieval alone is too weak to call the LLM. */
export function refusal(answer: string = REFUSAL_TEXT): ValidatedAnswer {
  return {
    answer,
    confidence: "low",
    citations: [],
    refused: true,
    droppedSourceIds: [],
  };
}
