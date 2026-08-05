/** Shared opaque-label resolver for every document-grounded model workflow. */

export interface DocumentCitationInput {
  sourceId: string;
  quote: string;
}

export interface DocumentCitationSource {
  id: string;
  content: string;
}

export interface ResolvedDocumentCitation {
  sourceId: string;
  chunkId: string;
  excerpt: string;
}

const MAX_EXCERPT = 320;

export function buildVerifiedExcerpt(quote: string, content: string) {
  const cleaned = quote.trim();
  if (cleaned && content.includes(cleaned)) return cleaned.slice(0, MAX_EXCERPT);
  const trimmed = content.trim();
  const head = trimmed.slice(0, MAX_EXCERPT);
  return trimmed.length > MAX_EXCERPT ? `${head}…` : head;
}

export function resolveDocumentCitations<T extends DocumentCitationSource>(
  citations: DocumentCitationInput[],
  sourceMap: Map<string, T>,
) {
  const resolved: ResolvedDocumentCitation[] = [];
  const droppedSourceIds: string[] = [];
  const seen = new Set<string>();

  for (const citation of citations) {
    const sourceId = citation.sourceId.trim().toUpperCase();
    const source = sourceMap.get(sourceId);
    if (!source) {
      droppedSourceIds.push(citation.sourceId);
      continue;
    }
    if (seen.has(source.id)) continue;
    seen.add(source.id);
    resolved.push({
      sourceId,
      chunkId: source.id,
      excerpt: buildVerifiedExcerpt(citation.quote, source.content),
    });
  }

  return { citations: resolved, droppedSourceIds };
}
