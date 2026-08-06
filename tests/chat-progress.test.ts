import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnswerPhase } from "@/lib/rag/answer";
import type { RetrievedChunk } from "@/lib/rag/retrieve";

/**
 * Phase progress.
 *
 * The point of reporting phases rather than a spinner is that they are true: a
 * first question really has no rewrite step, and a question with no evidence
 * really never reaches the model. If the phase list stopped matching the work,
 * it would be a more convincing lie than the spinner it replaced.
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

const validAnswer = {
  answer: "Restart the service.",
  confidence: "high",
  insufficientContext: false,
  citations: [{ sourceId: "S1", quote: "" }],
};

function chatReturning(payload: unknown) {
  return {
    modelName: "fake-chat",
    complete: vi.fn(async () => JSON.stringify(payload)),
  };
}

function progressSpy() {
  const phases: AnswerPhase[] = [];
  const onProgress = vi.fn((progress: { phase: AnswerPhase }) => {
    phases.push(progress.phase);
  });
  return { phases, onProgress };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("answerQuestion — phase progress", () => {
  it("reports no rewrite step on a first question", async () => {
    retrieveChunks.mockResolvedValue([chunk("c1", 0.9)]);
    const { phases, onProgress } = progressSpy();

    await answerQuestion("ws-1", "How do I promote the standby?", {
      embeddings,
      chat: chatReturning(validAnswer),
      minScore: 0.25,
      onProgress,
    });

    expect(phases).toEqual(["retrieving", "retrieved", "reasoning", "validating"]);
  });

  it("reports the rewrite step on a follow-up", async () => {
    retrieveChunks.mockResolvedValue([chunk("c1", 0.9)]);
    const { phases, onProgress } = progressSpy();
    const chat = {
      modelName: "fake-chat",
      complete: vi
        .fn()
        .mockResolvedValueOnce("How do I promote the standby for a Sev-2?")
        .mockResolvedValueOnce(JSON.stringify(validAnswer)),
    };

    await answerQuestion("ws-1", "what about for Sev-2?", {
      embeddings,
      chat,
      minScore: 0.25,
      history: [
        { role: "user", content: "How do I promote the standby?" },
        { role: "assistant", content: "Run `repmgr standby promote`." },
      ],
      onProgress,
    });

    expect(phases[0]).toBe("rewriting");
  });

  it("never reports reasoning when the evidence gate refuses", async () => {
    retrieveChunks.mockResolvedValue([chunk("c1", 0.1)]);
    const { phases, onProgress } = progressSpy();
    const chat = chatReturning(validAnswer);

    const result = await answerQuestion("ws-1", "unrelated question", {
      embeddings,
      chat,
      minScore: 0.25,
      onProgress,
    });

    // Invariant 4 restated on the progress channel: the user watches retrieval
    // finish and a refusal arrive, with no drafting step in between.
    expect(chat.complete).not.toHaveBeenCalled();
    expect(result.refused).toBe(true);
    expect(phases).toEqual(["retrieving", "retrieved"]);
  });

  it("reports the count of evidence that actually reaches the model", async () => {
    retrieveChunks.mockResolvedValue([chunk("c1", 0.9), chunk("c2", 0.05)]);
    const onProgress = vi.fn();

    await answerQuestion("ws-1", "question", {
      embeddings,
      chat: chatReturning(validAnswer),
      minScore: 0.25,
      onProgress,
    });

    expect(onProgress).toHaveBeenCalledWith({
      phase: "retrieved",
      chunkCount: 1,
      projectSourceCount: 0,
    });
  });

  it("reports exactly one repair when the model's first reply is unparseable", async () => {
    retrieveChunks.mockResolvedValue([chunk("c1", 0.9)]);
    const { phases, onProgress } = progressSpy();
    const chat = {
      modelName: "fake-chat",
      complete: vi
        .fn()
        .mockResolvedValueOnce("not json at all")
        .mockResolvedValueOnce(JSON.stringify(validAnswer)),
    };

    await answerQuestion("ws-1", "question", {
      embeddings,
      chat,
      minScore: 0.25,
      onProgress,
    });

    expect(phases.filter((phase) => phase === "repairing")).toEqual(["repairing"]);
  });

  it("still answers when the progress channel is dead", async () => {
    retrieveChunks.mockResolvedValue([chunk("c1", 0.9)]);

    // What a closed browser tab looks like: enqueueing onto a closed stream
    // throws. The answer still has to be produced, because it still has to be
    // persisted for when the thread is reopened.
    const result = await answerQuestion("ws-1", "question", {
      embeddings,
      chat: chatReturning(validAnswer),
      minScore: 0.25,
      onProgress: () => {
        throw new Error("stream already closed");
      },
    });

    expect(result.refused).toBe(false);
    expect(result.answer).toBe("Restart the service.");
  });
});
