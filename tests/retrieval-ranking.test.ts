import { describe, expect, it } from "vitest";
import {
  fuseRankedCandidates,
  hasGroundingEvidence,
  type RetrievalCandidate,
} from "@/lib/rag/ranking";

function candidate(
  id: string,
  semanticScore: number,
  lexicalScore = 0,
): RetrievalCandidate {
  return {
    id,
    documentId: `doc-${id}`,
    filename: "runbook.md",
    content: `Content for ${id}`,
    chunkIndex: 0,
    pageNumber: null,
    sectionTitle: null,
    semanticScore,
    lexicalScore,
  };
}

describe("hybrid retrieval ranking", () => {
  it("promotes a candidate found by both retrieval methods", () => {
    const vector = [candidate("semantic-only", 0.9), candidate("both", 0.8)];
    const lexical = [candidate("both", 0, 0.4), candidate("lexical-only", 0, 0.3)];

    const result = fuseRankedCandidates(vector, lexical, 3);

    expect(result.map((chunk) => chunk.id)).toEqual([
      "both",
      "semantic-only",
      "lexical-only",
    ]);
    expect(result[0]).toMatchObject({
      score: 0.8,
      lexicalScore: 0.4,
      matchType: "hybrid",
    });
  });

  it("de-duplicates candidates and respects topK", () => {
    const repeated = candidate("same", 0.7, 0.5);

    const result = fuseRankedCandidates([repeated], [repeated], 1);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("same");
  });

  it("accepts strong lexical evidence even below the semantic threshold", () => {
    const [chunk] = fuseRankedCandidates(
      [],
      [candidate("error-code", 0, 0.2)],
      1,
    );

    expect(hasGroundingEvidence(chunk, 0.25)).toBe(true);
    expect(chunk.matchType).toBe("lexical");
  });

  it("rejects a weak semantic-only candidate", () => {
    const [chunk] = fuseRankedCandidates(
      [candidate("weak", 0.1)],
      [],
      1,
    );

    expect(hasGroundingEvidence(chunk, 0.25)).toBe(false);
  });
});
