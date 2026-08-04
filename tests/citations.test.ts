import { describe, expect, it } from "vitest";
import { validateAnswer } from "@/lib/rag/citations";
import { REFUSAL_TEXT, type SourceMap } from "@/lib/rag/prompt";
import type { RetrievedChunk } from "@/lib/rag/retrieve";
import type { ModelAnswer } from "@/lib/schemas";

/**
 * The model is only ever shown opaque S1..Sn labels. These tests pin the rule
 * that it cannot cite anything outside the set it was given, and that an answer
 * left with no valid citation is refused rather than displayed.
 */

function chunk(id: string, content: string): RetrievedChunk {
  return {
    id,
    documentId: `doc-${id}`,
    filename: `${id}.md`,
    content,
    chunkIndex: 0,
    pageNumber: 3,
    sectionTitle: "Runbook",
    score: 0.8,
    lexicalScore: 0,
    matchType: "semantic",
  };
}

function sourceMap(...chunks: RetrievedChunk[]): SourceMap {
  return new Map(chunks.map((c, i) => [`S${i + 1}`, c]));
}

function answer(overrides: Partial<ModelAnswer> = {}): ModelAnswer {
  return {
    answer: "Restart the service.",
    confidence: "high",
    insufficientContext: false,
    citations: [{ sourceId: "S1", quote: "Restart the service" }],
    ...overrides,
  };
}

describe("validateAnswer — accepting valid citations", () => {
  it("resolves a supplied label to the real chunk", () => {
    const map = sourceMap(chunk("c1", "Restart the service using systemctl."));
    const result = validateAnswer(answer(), map);

    expect(result.refused).toBe(false);
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]).toMatchObject({
      chunkId: "c1",
      documentId: "doc-c1",
      filename: "c1.md",
      pageNumber: 3,
      sectionTitle: "Runbook",
    });
  });

  it("uses the model's quote when it really appears in the chunk", () => {
    const map = sourceMap(chunk("c1", "Escalate to the database on-call rota."));
    const result = validateAnswer(
      answer({
        citations: [{ sourceId: "S1", quote: "Escalate to the database on-call" }],
      }),
      map,
    );

    expect(result.citations[0].excerpt).toBe("Escalate to the database on-call");
  });

  it("falls back to the chunk text when the quote was not in the source", () => {
    const map = sourceMap(chunk("c1", "The real content of the chunk."));
    const result = validateAnswer(
      answer({
        citations: [{ sourceId: "S1", quote: "a quote that was never there" }],
      }),
      map,
    );

    // A fabricated quote must not be rendered as if it came from the document.
    expect(result.citations[0].excerpt).toBe("The real content of the chunk.");
  });

  it("is case-insensitive about the label and de-duplicates repeats", () => {
    const map = sourceMap(chunk("c1", "Content one."), chunk("c2", "Content two."));
    const result = validateAnswer(
      answer({
        citations: [
          { sourceId: "s1", quote: "" },
          { sourceId: "S1", quote: "" },
          { sourceId: "S2", quote: "" },
        ],
      }),
      map,
    );

    expect(result.citations.map((c) => c.chunkId)).toEqual(["c1", "c2"]);
  });
});

describe("validateAnswer — rejecting citations the model never received", () => {
  it("drops a label that was not supplied", () => {
    const map = sourceMap(chunk("c1", "Only source."));
    const result = validateAnswer(
      answer({
        citations: [
          { sourceId: "S1", quote: "" },
          { sourceId: "S9", quote: "invented" },
        ],
      }),
      map,
    );

    expect(result.citations.map((c) => c.chunkId)).toEqual(["c1"]);
    expect(result.droppedSourceIds).toEqual(["S9"]);
  });

  it("refuses when every citation is invalid", () => {
    const map = sourceMap(chunk("c1", "Only source."));
    const result = validateAnswer(
      answer({
        answer: "A confident but entirely unsupported claim.",
        citations: [{ sourceId: "S42", quote: "fabricated" }],
      }),
      map,
    );

    // The unsupported answer text must not survive.
    expect(result.refused).toBe(true);
    expect(result.answer).toBe(REFUSAL_TEXT);
    expect(result.confidence).toBe("low");
    expect(result.citations).toEqual([]);
    expect(result.droppedSourceIds).toEqual(["S42"]);
  });

  it("refuses an answer that cites nothing at all", () => {
    const result = validateAnswer(
      answer({ answer: "Unsupported claim.", citations: [] }),
      sourceMap(chunk("c1", "Some source.")),
    );

    expect(result.refused).toBe(true);
    expect(result.answer).toBe(REFUSAL_TEXT);
  });

  it("cannot cite a chunk from an empty source map", () => {
    const result = validateAnswer(answer(), new Map());

    expect(result.refused).toBe(true);
    expect(result.citations).toEqual([]);
  });
});

describe("validateAnswer — model-reported insufficient context", () => {
  it("refuses when the model sets insufficientContext, ignoring any answer text", () => {
    const map = sourceMap(chunk("c1", "Unrelated content."));
    const result = validateAnswer(
      answer({
        insufficientContext: true,
        answer: "Here is a guess anyway.",
        citations: [{ sourceId: "S1", quote: "" }],
      }),
      map,
    );

    expect(result.refused).toBe(true);
    expect(result.answer).toBe(REFUSAL_TEXT);
    expect(result.citations).toEqual([]);
  });
});
