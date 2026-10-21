import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A task links documents of its own project — and keeps any link the server
 * vouches for (one it already has, or the file a capture was made from) where
 * that document is filed. Neither widens past the workspace.
 */

const mockPrisma = {
  document: { findMany: vi.fn() },
  requirement: { findMany: vi.fn() },
  documentChunk: { findMany: vi.fn() },
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("server-only", () => ({}));

const { resolveTaskRelations } = await import("@/lib/pm/task-relations");

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.requirement.findMany.mockResolvedValue([]);
  mockPrisma.documentChunk.findMany.mockResolvedValue([]);
});

describe("resolveTaskRelations", () => {
  it("resolves a new link only inside the task's project", async () => {
    mockPrisma.document.findMany.mockResolvedValue([]);

    const result = await resolveTaskRelations("ws-1", "p1", { documentIds: ["doc-elsewhere"] });

    expect(result).toMatchObject({ ok: false });
    expect(mockPrisma.document.findMany.mock.calls[0][0].where).toEqual({
      id: { in: ["doc-elsewhere"] },
      workspaceId: "ws-1",
      projectId: "p1",
    });
  });

  it("accepts a carried link filed in another project, still within the workspace", async () => {
    mockPrisma.document.findMany.mockResolvedValue([{ id: "doc-p1" }, { id: "doc-personal" }]);

    const result = await resolveTaskRelations(
      "ws-1",
      "p1",
      { documentIds: ["doc-p1", "doc-personal"] },
      ["doc-personal"],
    );

    expect(result).toMatchObject({ ok: true, value: { documentIds: ["doc-p1", "doc-personal"] } });
    expect(mockPrisma.document.findMany.mock.calls[0][0].where).toEqual({
      id: { in: ["doc-p1", "doc-personal"] },
      workspaceId: "ws-1",
      OR: [{ projectId: "p1" }, { id: { in: ["doc-personal"] } }],
    });
  });

  it("keeps sources quoted from a carried document", async () => {
    mockPrisma.documentChunk.findMany.mockResolvedValue([{ id: "chunk-1", content: "Quote due Friday." }]);

    const result = await resolveTaskRelations(
      "ws-1",
      "p1",
      { citations: [{ chunkId: "chunk-1", quote: "Quote due Friday" }] },
      ["doc-personal"],
    );

    expect(result.ok && result.value.citations).toHaveLength(1);
    expect(mockPrisma.documentChunk.findMany.mock.calls[0][0].where.document).toEqual({
      workspaceId: "ws-1",
      OR: [{ projectId: "p1" }, { id: { in: ["doc-personal"] } }],
    });
  });
});
