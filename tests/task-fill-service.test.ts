import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  prisma: {
    document: { findMany: vi.fn() },
    requirement: { findMany: vi.fn() },
  },
  selectDocumentContext: vi.fn(),
  retrieveChunks: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ prisma: fakes.prisma }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ RAG_MIN_SCORE: 0.25 }) }));
vi.mock("@/lib/providers", () => ({
  getChatProvider: () => {
    throw new Error("tests inject a chat provider");
  },
  getEmbeddingProvider: () => {
    throw new Error("tests inject an embedding provider");
  },
}));
vi.mock("@/lib/rag/retrieve", () => ({ retrieveChunks: fakes.retrieveChunks }));
vi.mock("@/lib/generation/context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/generation/context")>();
  return { ...actual, selectDocumentContext: fakes.selectDocumentContext };
});

import { GenerationRequestError } from "@/lib/generation/service";
import {
  fillTask,
  NO_EVIDENCE_MESSAGE,
} from "@/lib/generation/task-fill-service";
import {
  LINKED_OVERVIEW_QUERY,
  MAX_FILL_CHUNKS,
  MAX_LINKED_FILL_CHUNKS,
} from "@/lib/generation/task-fill-prompt";

const chunk = {
  id: "chunk-real-id",
  documentId: "doc-1",
  filename: "kickoff.md",
  content: "The vendor must deliver the data migration by 15 October 2026.",
  chunkIndex: 0,
  pageNumber: 2,
  sectionTitle: "Timeline",
};

const embeddings = {
  modelName: "fake/embed",
  dimensions: 3,
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
};

function chatWith(...outputs: string[]) {
  return {
    modelName: "fake/filler",
    complete: vi.fn(async () => outputs.shift() ?? "{}"),
  };
}

const reply = JSON.stringify({
  description: {
    text: "Deliver the data migration.",
    citations: [{ sourceId: "S1", quote: "deliver the data migration" }],
  },
  priority: null,
  estimatedHours: null,
  startDate: null,
  dueDate: { value: "2026-10-15", citations: [{ sourceId: "S1", quote: "15 October 2026" }] },
  requirements: ["Q1"],
});

const base = {
  workspaceId: "ws-1",
  projectId: "project-1",
  title: "Migrate customer data",
};

beforeEach(() => {
  vi.clearAllMocks();
  fakes.prisma.requirement.findMany.mockResolvedValue([
    { id: "req-1", sequence: 7, title: "Migrate legacy data", status: "approved" },
  ]);
});

describe("fillTask", () => {
  it("reads only the linked documents when the task has some", async () => {
    fakes.prisma.document.findMany.mockResolvedValue([
      { id: "doc-1", originalFilename: "kickoff.md", status: "ready" },
    ]);
    fakes.selectDocumentContext.mockResolvedValue([chunk]);
    const chat = chatWith(reply);

    const result = await fillTask(
      { ...base, documentIds: ["doc-1"] },
      { chat, embeddings },
    );

    expect(fakes.selectDocumentContext).toHaveBeenCalledWith(
      "ws-1",
      ["doc-1"],
      embeddings,
      // The name alone would miss a deck named for what to do with it.
      ["Migrate customer data", LINKED_OVERVIEW_QUERY],
      MAX_LINKED_FILL_CHUNKS,
    );
    expect(fakes.retrieveChunks).not.toHaveBeenCalled();
    expect(result.evidence).toBe("linked");
    expect(result.fill).toMatchObject({
      description: "Deliver the data migration.",
      dueDate: "2026-10-15",
      requirements: [{ id: "req-1", code: "REQ-007", status: "approved" }],
    });
    expect(result.sources).toEqual([
      expect.objectContaining({
        chunkId: "chunk-real-id",
        documentId: "doc-1",
        fields: ["description", "dueDate"],
      }),
    ]);
  });

  it("never shows the model a database id", async () => {
    fakes.prisma.document.findMany.mockResolvedValue([
      { id: "doc-1", originalFilename: "kickoff.md", status: "ready" },
    ]);
    fakes.selectDocumentContext.mockResolvedValue([chunk]);
    const chat = chatWith(reply);

    await fillTask({ ...base, documentIds: ["doc-1"] }, { chat, embeddings });

    const sent = JSON.stringify(chat.complete.mock.calls[0]);
    expect(sent).toContain("[S1]");
    // The model is told these are the task's own material, not search hits.
    expect(sent).toContain("LINKED by the user to this task");
    expect(sent).toContain("Q1 [agreed]: Migrate legacy data");
    expect(sent).not.toContain("chunk-real-id");
    expect(sent).not.toContain("req-1");
    expect(sent).not.toContain("doc-1");
  });

  it("refuses a linked document that is still processing", async () => {
    fakes.prisma.document.findMany.mockResolvedValue([
      { id: "doc-1", originalFilename: "kickoff.md", status: "processing" },
    ]);
    const chat = chatWith(reply);

    await expect(
      fillTask({ ...base, documentIds: ["doc-1"] }, { chat, embeddings }),
    ).rejects.toMatchObject({ status: 409 });
    expect(chat.complete).not.toHaveBeenCalled();
  });

  it("searches the project and keeps only passages that clear the relevance gate", async () => {
    fakes.retrieveChunks.mockResolvedValue([
      { ...chunk, score: 0.8, lexicalScore: 0, matchType: "semantic" },
      { ...chunk, id: "weak", score: 0.1, lexicalScore: 0, matchType: "semantic" },
    ]);
    const chat = chatWith(reply);

    const result = await fillTask({ ...base, documentIds: [] }, { chat, embeddings });

    expect(fakes.retrieveChunks).toHaveBeenCalledWith(
      "ws-1",
      [0.1, 0.2, 0.3],
      "Migrate customer data",
      MAX_FILL_CHUNKS,
      "project-1",
    );
    expect(result.evidence).toBe("project");
    const sent = JSON.stringify(chat.complete.mock.calls[0]);
    expect(sent).not.toContain("[S2]");
    expect(sent).toContain("FOUND BY SEARCHING the project");
  });

  it("refuses without calling the model when nothing in the project matches", async () => {
    fakes.retrieveChunks.mockResolvedValue([
      { ...chunk, score: 0.1, lexicalScore: 0, matchType: "semantic" },
    ]);
    const chat = chatWith(reply);

    const error = await fillTask(
      { ...base, documentIds: [] },
      { chat, embeddings },
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GenerationRequestError);
    expect(error).toMatchObject({ status: 422, message: NO_EVIDENCE_MESSAGE });
    expect(chat.complete).not.toHaveBeenCalled();
  });

  it("repairs a malformed reply once, then gives up", async () => {
    fakes.retrieveChunks.mockResolvedValue([
      { ...chunk, score: 0.8, lexicalScore: 0, matchType: "semantic" },
    ]);

    const repaired = chatWith("not json", reply);
    const result = await fillTask({ ...base, documentIds: [] }, { chat: repaired, embeddings });
    expect(repaired.complete).toHaveBeenCalledTimes(2);
    expect(result.fill.dueDate).toBe("2026-10-15");

    const broken = chatWith("not json", "still not json");
    await expect(
      fillTask({ ...base, documentIds: [] }, { chat: broken, embeddings }),
    ).rejects.toMatchObject({ status: 422 });
    expect(broken.complete).toHaveBeenCalledTimes(2);
  });
});
