import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = {
  documentChunk: { findMany: vi.fn() },
  document: { findMany: vi.fn() },
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ RAG_MIN_SCORE: 0.25 }) }));
const mockRetrieve = vi.fn();
vi.mock("@/lib/rag/retrieve", () => ({ retrieveChunks: mockRetrieve }));

const { searchDocuments } = await import("@/lib/documents/search");

const access = { workspaceId: "ws-1", workspaceName: "Ops", userId: "u-1", role: "member" as const };
const embeddings = { modelName: "fake", dimensions: 3, embed: vi.fn(async () => [[0.1, 0.2, 0.3]]) };

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.documentChunk.findMany.mockResolvedValue([]);
  mockPrisma.document.findMany.mockImplementation(async ({ where }) =>
    where.id
      ? where.id.in.map((id: string) => ({
          id,
          title: `Title ${id}`,
          originalFilename: `${id}.pdf`,
          projectId: null,
          project: null,
        }))
      : [],
  );
  mockRetrieve.mockResolvedValue([]);
});

describe("searchDocuments", () => {
  it("does nothing for a query shorter than two characters", async () => {
    expect(await searchDocuments(access, " a ", { embeddings })).toEqual([]);
    expect(mockPrisma.documentChunk.findMany).not.toHaveBeenCalled();
  });

  it("matches the text literally inside the caller's workspace, one hit per document", async () => {
    mockPrisma.documentChunk.findMany.mockResolvedValue([
      { id: "c1", documentId: "d1", content: "本公司就伺服器升級提供報價", pageNumber: 2 },
      { id: "c2", documentId: "d1", content: "報價有效期至十一月", pageNumber: 3 },
    ]);

    const hits = await searchDocuments(access, "報價", { embeddings });

    const where = mockPrisma.documentChunk.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      workspaceId: "ws-1",
      content: { contains: "報價", mode: "insensitive" },
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ documentId: "d1", chunkId: "c1", kind: "text", pageNumber: 2 });
  });

  it("orders literal text first, then labels, then related meaning", async () => {
    mockPrisma.documentChunk.findMany.mockResolvedValue([
      { id: "c1", documentId: "d-text", content: "quote for ABC", pageNumber: null },
    ]);
    mockPrisma.document.findMany.mockImplementation(async ({ where }) =>
      where.id
        ? where.id.in.map((id: string) => ({ id, title: null, originalFilename: id, projectId: null, project: null }))
        : [{ id: "d-label", summary: "ABC quote summary" }],
    );
    mockRetrieve.mockResolvedValue([
      { id: "c9", documentId: "d-meaning", content: "pricing proposal", pageNumber: 1, score: 0.6, lexicalScore: 0 },
      { id: "c8", documentId: "d-weak", content: "unrelated", pageNumber: 1, score: 0.1, lexicalScore: 0 },
    ]);

    const hits = await searchDocuments(access, "quote", { embeddings });

    expect(hits.map((hit) => [hit.documentId, hit.kind])).toEqual([
      ["d-text", "text"],
      ["d-label", "label"],
      ["d-meaning", "meaning"],
    ]);
  });

  it("still returns literal matches when embeddings are unavailable", async () => {
    mockPrisma.documentChunk.findMany.mockResolvedValue([
      { id: "c1", documentId: "d1", content: "contract renewal", pageNumber: null },
    ]);
    const broken = { ...embeddings, embed: vi.fn(async () => { throw new Error("no key"); }) };

    const hits = await searchDocuments(access, "contract", { embeddings: broken });
    expect(hits.map((hit) => hit.documentId)).toEqual(["d1"]);
  });
});
