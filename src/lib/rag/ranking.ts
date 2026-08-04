export type RetrievalMatchType = "semantic" | "lexical" | "hybrid";

export interface RetrievalCandidate {
  id: string;
  documentId: string;
  filename: string;
  content: string;
  chunkIndex: number;
  pageNumber: number | null;
  sectionTitle: string | null;
  semanticScore: number;
  lexicalScore: number;
}

export interface RetrievedChunk {
  id: string;
  documentId: string;
  filename: string;
  content: string;
  chunkIndex: number;
  pageNumber: number | null;
  sectionTitle: string | null;
  /** Cosine similarity, kept stable for threshold tuning and citation display. */
  score: number;
  /** PostgreSQL full-text rank; positive means every query lexeme matched. */
  lexicalScore: number;
  matchType: RetrievalMatchType;
}

const RRF_RANK_CONSTANT = 60;

interface FusedCandidate {
  candidate: RetrievalCandidate;
  vectorRank?: number;
  lexicalRank?: number;
}

/**
 * Reciprocal-rank fusion combines rankings without pretending cosine
 * similarity and PostgreSQL text rank are directly comparable.
 */
export function fuseRankedCandidates(
  vectorCandidates: RetrievalCandidate[],
  lexicalCandidates: RetrievalCandidate[],
  topK: number,
): RetrievedChunk[] {
  if (topK <= 0) return [];

  const fused = new Map<string, FusedCandidate>();

  vectorCandidates.forEach((candidate, index) => {
    fused.set(candidate.id, {
      candidate: { ...candidate },
      vectorRank: index + 1,
    });
  });

  lexicalCandidates.forEach((candidate, index) => {
    const existing = fused.get(candidate.id);
    if (existing) {
      existing.lexicalRank = index + 1;
      existing.candidate.semanticScore = Math.max(
        existing.candidate.semanticScore,
        candidate.semanticScore,
      );
      existing.candidate.lexicalScore = Math.max(
        existing.candidate.lexicalScore,
        candidate.lexicalScore,
      );
      return;
    }

    fused.set(candidate.id, {
      candidate: { ...candidate },
      lexicalRank: index + 1,
    });
  });

  return [...fused.values()]
    .map((entry) => {
      const fusedScore =
        (entry.vectorRank
          ? 1 / (RRF_RANK_CONSTANT + entry.vectorRank)
          : 0) +
        (entry.lexicalRank
          ? 1 / (RRF_RANK_CONSTANT + entry.lexicalRank)
          : 0);
      return { ...entry, fusedScore };
    })
    .sort(
      (a, b) =>
        b.fusedScore - a.fusedScore ||
        b.candidate.semanticScore - a.candidate.semanticScore ||
        a.candidate.id.localeCompare(b.candidate.id),
    )
    .slice(0, topK)
    .map(({ candidate, vectorRank, lexicalRank }) => ({
      id: candidate.id,
      documentId: candidate.documentId,
      filename: candidate.filename,
      content: candidate.content,
      chunkIndex: candidate.chunkIndex,
      pageNumber: candidate.pageNumber,
      sectionTitle: candidate.sectionTitle,
      score: candidate.semanticScore,
      lexicalScore: candidate.lexicalScore,
      matchType:
        vectorRank && lexicalRank
          ? "hybrid"
          : lexicalRank
            ? "lexical"
            : "semantic",
    }));
}

/** Lexical candidates already matched every non-stopword query lexeme. */
export function hasGroundingEvidence(
  chunk: RetrievedChunk,
  minSemanticScore: number,
): boolean {
  return chunk.score >= minSemanticScore || chunk.lexicalScore > 0;
}
