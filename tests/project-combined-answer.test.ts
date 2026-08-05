import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectGroundingSource } from "@/lib/rag/project-context";
import type { RetrievedChunk } from "@/lib/rag/retrieve";

const retrieveChunks = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ prisma: {}, toVectorLiteral: () => "[]" }));
vi.mock("@/lib/rag/retrieve", () => ({ retrieveChunks }));
vi.mock("@/lib/providers", () => ({
  getEmbeddingProvider: () => {
    throw new Error("provider must be injected");
  },
  getChatProvider: () => {
    throw new Error("provider must be injected");
  },
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ RAG_TOP_K: 8, RAG_MIN_SCORE: 0.25 }),
}));

const { answerQuestion } = await import("@/lib/rag/answer");

const embeddings = {
  modelName: "fake-embed",
  dimensions: 3,
  embed: vi.fn(async () => [[0.1, 0.2, 0.3]]),
};

function documentChunk(): RetrievedChunk {
  return {
    id: "real-chunk-id",
    documentId: "real-document-id",
    filename: "requirements.md",
    content: "UAT starts only after security approval is complete.",
    chunkIndex: 0,
    pageNumber: 4,
    sectionTitle: "Acceptance",
    score: 0.91,
    lexicalScore: 0.6,
    matchType: "hybrid",
  };
}

function liveSource(
  kind: ProjectGroundingSource["kind"],
  overrides: Partial<ProjectGroundingSource> = {},
): ProjectGroundingSource {
  return {
    kind,
    id: `real-${kind}-database-id`,
    title:
      kind === "project_snapshot"
        ? "Launch snapshot"
        : "Security approval blocks UAT",
    content:
      kind === "project_snapshot"
        ? "Exact dependency counts: 1 total; 1 currently blocked by an unfinished prerequisite."
        : "Dependency: UAT depends on Security approval\nPrerequisite status: in progress\nCurrently blocking: yes",
    href: "/projects/real-project-database-id/tasks",
    observedAt: "2026-08-05T08:00:00.000Z",
    snapshot: { status: "in_progress", blocking: true },
    ...overrides,
  };
}

function context(...sources: ProjectGroundingSource[]) {
  return vi.fn(async () => ({
    sources,
    observedAt: "2026-08-05T08:00:00.000Z",
    hasProjectData: sources.length > 0,
    totalDetailedRecords: Math.max(0, sources.length - 1),
    selectedDetailedRecords: Math.max(0, sources.length - 1),
    partial: false,
  }));
}

function chatReturning(payload: unknown) {
  return {
    modelName: "fake-chat",
    complete: vi.fn(
      async (
        _messages: Array<{
          role: "system" | "user" | "assistant";
          content: string;
        }>,
      ) => JSON.stringify(payload),
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("project-combined grounding", () => {
  it("answers a live-only current-state question without indexed documents", async () => {
    retrieveChunks.mockResolvedValue([]);
    const source = liveSource("task", {
      title: "Prepare UAT environment",
      content: "Task: Prepare UAT environment\nStatus: blocked\nDue date: 2026-08-08",
      snapshot: { status: "blocked", dueDate: "2026-08-08" },
    });
    const result = await answerQuestion("ws-1", "What is the current task status?", {
      projectId: "project-1",
      groundingScope: "project_combined",
      embeddings,
      chat: chatReturning({
        answer: "The UAT environment task is blocked.",
        confidence: "high",
        insufficientContext: false,
        citations: [{ sourceId: "T1", quote: "Status: blocked" }],
      }),
      projectContext: context(source),
    });

    expect(result.refused).toBe(false);
    expect(result.citations).toEqual([
      expect.objectContaining({
        kind: "task",
        title: "Prepare UAT environment",
        snapshot: { status: "blocked", dueDate: "2026-08-08" },
      }),
    ]);
    expect(result.citations[0]).not.toHaveProperty("recordId");
    expect(result.groundingSourceIds[0]).toMatchObject({
      kind: "task",
      id: "real-task-database-id",
    });
  });

  it("allows a document-only requirements answer when live data is also supplied", async () => {
    retrieveChunks.mockResolvedValue([documentChunk()]);
    const result = await answerQuestion("ws-1", "What are the UAT acceptance criteria?", {
      projectId: "project-1",
      groundingScope: "project_combined",
      embeddings,
      chat: chatReturning({
        answer: "UAT starts after security approval.",
        confidence: "high",
        insufficientContext: false,
        citations: [
          {
            sourceId: "S1",
            quote: "UAT starts only after security approval is complete.",
          },
        ],
      }),
      projectContext: context(liveSource("project_snapshot")),
    });

    expect(result.refused).toBe(false);
    expect(result.citations.map((citation) => citation.kind)).toEqual(["document"]);
  });

  it("requires both citation families and both headings for a UAT blocker question", async () => {
    retrieveChunks.mockResolvedValue([documentChunk()]);
    const dependency = liveSource("dependency");
    const chat = chatReturning({
      answer:
        "Document requirements\nUAT requires security approval.\n\nCurrent project state\nSecurity approval is still in progress and blocks UAT.",
      confidence: "high",
      insufficientContext: false,
      citations: [
        { sourceId: "S1", quote: "UAT starts only after security approval" },
        { sourceId: "D1", quote: "Currently blocking: yes" },
      ],
    });
    const result = await answerQuestion(
      "ws-1",
      "What currently blocks the UAT acceptance requirement?",
      {
        projectId: "project-1",
        groundingScope: "project_combined",
        embeddings,
        chat,
        projectContext: context(dependency),
      },
    );

    expect(result.refused).toBe(false);
    expect(result.citations.map((citation) => citation.kind)).toEqual([
      "document",
      "dependency",
    ]);
    const prompt = chat.complete.mock.calls[0][0]
      .map((message) => message.content)
      .join("\n");
    expect(prompt).not.toContain("real-chunk-id");
    expect(prompt).not.toContain("real-document-id");
    expect(prompt).not.toContain("real-dependency-database-id");
    expect(prompt).not.toContain("real-project-database-id");
  });

  it("refuses a mixed UAT blocker answer missing the document citation", async () => {
    retrieveChunks.mockResolvedValue([documentChunk()]);
    const result = await answerQuestion(
      "ws-1",
      "What currently blocks the UAT acceptance requirement?",
      {
        projectId: "project-1",
        groundingScope: "project_combined",
        embeddings,
        chat: chatReturning({
          answer: "Security approval blocks UAT.",
          confidence: "high",
          insufficientContext: false,
          citations: [{ sourceId: "D1", quote: "Currently blocking: yes" }],
        }),
        projectContext: context(liveSource("dependency")),
      },
    );

    expect(result.refused).toBe(true);
    expect(result.citations).toEqual([]);
  });

  it("refuses a mixed answer without the required section headings", async () => {
    retrieveChunks.mockResolvedValue([documentChunk()]);
    const result = await answerQuestion(
      "ws-1",
      "What currently blocks the UAT acceptance requirement?",
      {
        projectId: "project-1",
        groundingScope: "project_combined",
        embeddings,
        chat: chatReturning({
          answer: "Security approval is required and is still in progress.",
          confidence: "high",
          insufficientContext: false,
          citations: [
            { sourceId: "S1", quote: "security approval is complete" },
            { sourceId: "D1", quote: "Currently blocking: yes" },
          ],
        }),
        projectContext: context(liveSource("dependency")),
      },
    );

    expect(result.refused).toBe(true);
  });

  it("refuses when an inferred current-state family is not supplied", async () => {
    retrieveChunks.mockResolvedValue([documentChunk()]);
    const result = await answerQuestion("ws-1", "What is the current task status?", {
      projectId: "project-1",
      groundingScope: "project_combined",
      embeddings,
      chat: chatReturning({
        answer: "The document describes UAT approval.",
        confidence: "medium",
        insufficientContext: false,
        citations: [{ sourceId: "S1", quote: "security approval" }],
      }),
      projectContext: context(),
    });

    expect(result.refused).toBe(true);
  });

  it("refuses a mixed UAT blocker question when no document evidence was supplied", async () => {
    retrieveChunks.mockResolvedValue([]);
    const result = await answerQuestion(
      "ws-1",
      "What currently blocks the UAT acceptance requirement?",
      {
        projectId: "project-1",
        groundingScope: "project_combined",
        embeddings,
        chat: chatReturning({
          answer: "Security approval currently blocks UAT.",
          confidence: "high",
          insufficientContext: false,
          citations: [{ sourceId: "D1", quote: "Currently blocking: yes" }],
        }),
        projectContext: context(liveSource("dependency")),
      },
    );

    expect(result.refused).toBe(true);
  });
});
