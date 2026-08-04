import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RetrievedChunk } from "@/lib/rag/retrieve";

/**
 * "Insufficient context" behaviour.
 *
 * The load-bearing assertion here is not just that a refusal is returned, but
 * that the chat provider is NEVER CALLED when retrieval is too weak. That makes
 * the first grounding guard deterministic and free, instead of depending on the
 * model choosing to behave.
 */

const retrieveChunks = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/rag/retrieve", () => ({ retrieveChunks }));
vi.mock("@/lib/db", () => ({ prisma: {}, toVectorLiteral: () => "[]" }));
vi.mock("@/lib/providers", () => ({
  getEmbeddingProvider: () => {
    throw new Error("should not be constructed in tests");
  },
  getChatProvider: () => {
    throw new Error("should not be constructed in tests");
  },
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ RAG_TOP_K: 8, RAG_MIN_SCORE: 0.25 }),
}));

const { answerQuestion } = await import("@/lib/rag/answer");
const { REFUSAL_TEXT } = await import("@/lib/rag/prompt");

function chunk(id: string, score: number): RetrievedChunk {
  return {
    id,
    documentId: `doc-${id}`,
    filename: "runbook.md",
    content: `Content of ${id}.`,
    chunkIndex: 0,
    pageNumber: null,
    sectionTitle: null,
    score,
    lexicalScore: 0,
    matchType: "semantic",
  };
}

const embeddings = {
  modelName: "fake-embed",
  dimensions: 3,
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
};

function chatReturning(payload: unknown) {
  return {
    modelName: "fake-chat",
    complete: vi.fn(async () => JSON.stringify(payload)),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("retrieval gate — refusing before the model is called", () => {
  it("passes the selected project into retrieval", async () => {
    retrieveChunks.mockResolvedValue([]);

    await answerQuestion("ws-1", "project question", {
      embeddings,
      chat: chatReturning({}),
      projectId: "project-1",
    });

    expect(retrieveChunks).toHaveBeenCalledWith(
      "ws-1",
      [0.1, 0.2, 0.3],
      "project question",
      8,
      "project-1",
    );
  });

  it("refuses without invoking the chat provider when all scores are below the threshold", async () => {
    retrieveChunks.mockResolvedValue([chunk("c1", 0.10), chunk("c2", 0.05)]);
    const chat = chatReturning({ answer: "should never be produced" });

    const result = await answerQuestion("ws-1", "unrelated question", {
      embeddings,
      chat,
      minScore: 0.25,
    });

    expect(chat.complete).not.toHaveBeenCalled();
    expect(result.refused).toBe(true);
    expect(result.answer).toBe(REFUSAL_TEXT);
    expect(result.confidence).toBe("low");
    expect(result.citations).toEqual([]);
  });

  it("refuses when retrieval returns nothing at all", async () => {
    retrieveChunks.mockResolvedValue([]);
    const chat = chatReturning({ answer: "nope" });

    const result = await answerQuestion("ws-1", "question", {
      embeddings,
      chat,
    });

    expect(chat.complete).not.toHaveBeenCalled();
    expect(result.refused).toBe(true);
  });

  it("still records which chunks were considered, for later inspection", async () => {
    retrieveChunks.mockResolvedValue([chunk("c1", 0.1)]);

    const result = await answerQuestion("ws-1", "question", {
      embeddings,
      chat: chatReturning({}),
      minScore: 0.25,
    });

    expect(result.retrievedChunkIds).toEqual(["c1"]);
    expect(result.modelName).toBe("fake-chat");
  });

  it("calls the model once at least one chunk clears the threshold", async () => {
    retrieveChunks.mockResolvedValue([chunk("c1", 0.9), chunk("c2", 0.1)]);
    const chat = chatReturning({
      answer: "Restart the service.",
      confidence: "high",
      insufficientContext: false,
      citations: [{ sourceId: "S1", quote: "Content of c1." }],
    });

    const result = await answerQuestion("ws-1", "question", {
      embeddings,
      chat,
      minScore: 0.25,
    });

    expect(chat.complete).toHaveBeenCalledTimes(1);
    expect(result.refused).toBe(false);
    expect(result.answer).toBe("Restart the service.");
    // Only the chunk that cleared the threshold is sent to the model.
    expect(result.retrievedChunkIds).toEqual(["c1"]);
  });

  it("calls the model for an exact lexical match below the semantic threshold", async () => {
    const lexicalChunk = {
      ...chunk("error-code", 0.1),
      lexicalScore: 0.4,
      matchType: "lexical" as const,
    };
    retrieveChunks.mockResolvedValue([lexicalChunk]);
    const chat = chatReturning({
      answer: "Error OPS-104 requires escalation.",
      confidence: "high",
      insufficientContext: false,
      citations: [{ sourceId: "S1", quote: "Content of error-code." }],
    });

    const result = await answerQuestion("ws-1", "What is OPS-104?", {
      embeddings,
      chat,
      minScore: 0.25,
    });

    expect(chat.complete).toHaveBeenCalledTimes(1);
    expect(result.refused).toBe(false);
    expect(result.retrievedChunkIds).toEqual(["error-code"]);
  });
});

describe("model-reported insufficient context", () => {
  it("renders the refusal when the model reports it cannot answer", async () => {
    retrieveChunks.mockResolvedValue([chunk("c1", 0.9)]);
    const chat = chatReturning({
      answer: "I am not sure, but possibly restart it.",
      confidence: "low",
      insufficientContext: true,
      citations: [],
    });

    const result = await answerQuestion("ws-1", "question", {
      embeddings,
      chat,
      minScore: 0.25,
    });

    expect(result.refused).toBe(true);
    expect(result.answer).toBe(REFUSAL_TEXT);
  });
});

describe("malformed model output", () => {
  it("retries once, then refuses rather than showing unparseable output", async () => {
    retrieveChunks.mockResolvedValue([chunk("c1", 0.9)]);
    const chat = {
      modelName: "fake-chat",
      complete: vi.fn(async () => "not json at all"),
    };

    const result = await answerQuestion("ws-1", "question", {
      embeddings,
      chat,
      minScore: 0.25,
    });

    expect(chat.complete).toHaveBeenCalledTimes(2);
    expect(result.refused).toBe(true);
    expect(result.answer).toBe(REFUSAL_TEXT);
  });

  it("recovers JSON wrapped in a markdown fence", async () => {
    retrieveChunks.mockResolvedValue([chunk("c1", 0.9)]);
    const chat = {
      modelName: "fake-chat",
      complete: vi.fn(
        async () =>
          '```json\n{"answer":"Restart it.","confidence":"high","insufficientContext":false,"citations":[{"sourceId":"S1","quote":""}]}\n```',
      ),
    };

    const result = await answerQuestion("ws-1", "question", {
      embeddings,
      chat,
      minScore: 0.25,
    });

    expect(chat.complete).toHaveBeenCalledTimes(1);
    expect(result.refused).toBe(false);
    expect(result.answer).toBe("Restart it.");
  });

  it("refuses when the model cites a source it was never given", async () => {
    retrieveChunks.mockResolvedValue([chunk("c1", 0.9)]);
    const chat = chatReturning({
      answer: "A claim with a fabricated citation.",
      confidence: "high",
      insufficientContext: false,
      citations: [{ sourceId: "S7", quote: "never supplied" }],
    });

    const result = await answerQuestion("ws-1", "question", {
      embeddings,
      chat,
      minScore: 0.25,
    });

    expect(result.refused).toBe(true);
    expect(result.answer).toBe(REFUSAL_TEXT);
    expect(result.droppedSourceIds).toEqual(["S7"]);
  });
});
