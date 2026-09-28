import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RetrievedChunk } from "@/lib/rag/retrieve";
import type { ProjectGroundingSource } from "@/lib/rag/project-context";

/**
 * Task-focused chat: the task's own record is always evidence, retrieval reads
 * the task's linked documents, and proposals clear the same bar as the AI fill.
 */

const retrieveChunks = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/rag/retrieve", () => ({ retrieveChunks }));
vi.mock("@/lib/db", () => ({ prisma: {}, toVectorLiteral: () => "[]" }));
vi.mock("@/lib/providers", () => ({
  getEmbeddingProvider: () => {
    throw new Error("tests inject providers");
  },
  getChatProvider: () => {
    throw new Error("tests inject providers");
  },
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ RAG_TOP_K: 8, RAG_MIN_SCORE: 0.25 }),
}));

const { answerQuestion } = await import("@/lib/rag/answer");
const { TASK_REFUSAL_TEXT } = await import("@/lib/rag/prompt");
const { validateProposals } = await import("@/lib/rag/proposals");
const { proposalPatch } = await import("@/components/chat/proposal-card");

const chunk: RetrievedChunk = {
  id: "chunk-real-id",
  documentId: "doc-1",
  filename: "kickoff.md",
  content: "The rehearsal must be completed by 30 October 2026. Effort is 3 days.",
  chunkIndex: 0,
  pageNumber: 2,
  sectionTitle: null,
  score: 0.8,
  lexicalScore: 0,
  matchType: "semantic",
};

const taskRecord: ProjectGroundingSource = {
  kind: "task",
  id: "task-real-id",
  title: "Run the rehearsal",
  content: "Task: Run the rehearsal\nStatus: Backlog\nPriority: medium",
  href: "/projects/p1/tasks?task=task-real-id",
  observedAt: "2026-09-28T00:00:00.000Z",
  snapshot: { title: "Run the rehearsal" },
};

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

const taskContext = vi.fn(async () => ({
  task: { id: "task-real-id", projectId: "p1", title: "Run the rehearsal" },
  sources: [taskRecord],
  observedAt: taskRecord.observedAt,
}));

function askAboutTask(payload: unknown, documentIds: string[] = ["doc-1"]) {
  const chat = chatReturning(payload);
  const result = answerQuestion("ws-1", "When is it due?", {
    embeddings,
    chat,
    projectId: "p1",
    groundingScope: "project_combined",
    focus: { kind: "task", taskId: "task-real-id", documentIds },
    taskContext,
  });
  return { chat, result };
}

beforeEach(() => {
  vi.clearAllMocks();
  retrieveChunks.mockResolvedValue([chunk]);
});

describe("task-focused answers", () => {
  it("reads the task's linked documents and always supplies the task as T1", async () => {
    const { chat, result } = askAboutTask({
      answer: "It is due 30 October 2026 [S1].",
      confidence: "high",
      citations: [{ sourceId: "S1", quote: "completed by 30 October 2026" }],
    });
    const answer = await result;

    expect(retrieveChunks).toHaveBeenCalledWith(
      "ws-1",
      [0.1, 0.2, 0.3],
      "When is it due?",
      8,
      "p1",
      ["doc-1"],
    );
    expect(taskContext).toHaveBeenCalledWith("ws-1", "p1", "task-real-id", expect.any(Date));
    const sent = JSON.stringify(chat.complete.mock.calls[0]);
    expect(sent).toContain("[T1]");
    expect(sent).toContain("ONE task");
    // Real ids never reach the model.
    expect(sent).not.toContain("task-real-id");
    expect(sent).not.toContain("chunk-real-id");
    expect(answer.refused).toBe(false);
  });

  it("searches the whole project when the task has no linked documents", async () => {
    await askAboutTask(
      { answer: "Unknown.", confidence: "low", insufficientContext: true },
      [],
    ).result;
    expect(retrieveChunks.mock.calls[0][5]).toBeNull();
  });

  it("answers from the task record alone, citing only T1, without refusing", async () => {
    retrieveChunks.mockResolvedValue([]);
    const answer = await askAboutTask({
      answer: "It is in Backlog [T1].",
      confidence: "high",
      citations: [{ sourceId: "T1", quote: "Status: Backlog" }],
    }).result;
    expect(answer.refused).toBe(false);
    expect(answer.citations[0]).toMatchObject({ kind: "task", label: "T1" });
  });

  it("keeps cited proposals and drops ones the sources do not state", async () => {
    const answer = await askAboutTask({
      answer: "I propose a due date and an estimate [S1].",
      confidence: "high",
      citations: [{ sourceId: "S1", quote: "30 October 2026" }],
      proposals: [
        { field: "dueDate", value: "2026-10-30", citations: [{ sourceId: "S1", quote: "30 October 2026" }] },
        { field: "estimatedHours", value: 24, citations: [{ sourceId: "S1", quote: "3 days" }] },
        // Not in the source: invented.
        { field: "startDate", value: "2026-10-01", citations: [{ sourceId: "S1" }] },
        // No citation at all.
        { field: "priority", value: "urgent", citations: [] },
      ],
    }).result;

    expect(answer.proposals.map((proposal) => [proposal.field, proposal.value])).toEqual([
      ["estimatedHours", 24],
      ["dueDate", "2026-10-30"],
    ]);
    expect(answer.proposals[1].citations[0]).toMatchObject({
      label: "S1",
      kind: "document",
      chunkId: "chunk-real-id",
    });
  });

  it("offers nothing to apply from a refused answer", async () => {
    const answer = await askAboutTask({
      answer: "It is due 30 October 2026.",
      confidence: "high",
      citations: [{ sourceId: "S9" }],
      proposals: [
        { field: "dueDate", value: "2026-10-30", citations: [{ sourceId: "S1" }] },
      ],
    }).result;
    expect(answer.refused).toBe(true);
    expect(answer.answer).toBe(TASK_REFUSAL_TEXT);
    expect(answer.proposals).toEqual([]);
  });

  it("does not offer proposals outside a task thread", async () => {
    const answer = await answerQuestion("ws-1", "When is it due?", {
      embeddings,
      chat: chatReturning({
        answer: "30 October 2026 [S1].",
        confidence: "high",
        citations: [{ sourceId: "S1" }],
        proposals: [
          { field: "dueDate", value: "2026-10-30", citations: [{ sourceId: "S1" }] },
        ],
      }),
    });
    expect(answer.proposals).toEqual([]);
  });
});

describe("validateProposals", () => {
  const sourceMap = new Map<string, RetrievedChunk | ProjectGroundingSource>([
    ["S1", chunk],
    ["T1", taskRecord],
  ]);

  it("marks a live-record citation as a record with no chunk to store", () => {
    const [proposal] = validateProposals(
      [
        {
          field: "description",
          value: "Run the rehearsal.",
          citations: [{ sourceId: "T1", quote: "Run the rehearsal" }],
        },
      ],
      sourceMap,
    );
    expect(proposal.citations[0]).toMatchObject({ kind: "record", chunkId: null });
  });

  it("takes the first proposal for a field and ignores repeats", () => {
    const proposals = validateProposals(
      [
        { field: "dueDate", value: "2026-10-30", citations: [{ sourceId: "S1", quote: "" }] },
        { field: "dueDate", value: "2026-11-30", citations: [{ sourceId: "S1", quote: "" }] },
      ],
      sourceMap,
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0].value).toBe("2026-10-30");
  });
});

describe("proposalPatch", () => {
  it("sends the field and only the document passages as citations", () => {
    expect(
      proposalPatch({
        field: "dueDate",
        value: "2026-10-30",
        citations: [
          { label: "S1", kind: "document", chunkId: "chunk-1", excerpt: "by 30 October 2026" },
          { label: "T1", kind: "record", chunkId: null, excerpt: "Status: Backlog" },
        ],
      }),
    ).toEqual({
      dueDate: "2026-10-30",
      citations: [{ chunkId: "chunk-1", quote: "by 30 October 2026" }],
    });
  });

  it("sends no citations key when no document backs the proposal", () => {
    expect(
      proposalPatch({
        field: "priority",
        value: "high",
        citations: [{ label: "T1", kind: "record", chunkId: null, excerpt: "…" }],
      }),
    ).toEqual({ priority: "high" });
  });
});
