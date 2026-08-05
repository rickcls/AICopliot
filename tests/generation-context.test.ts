import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  prisma: {
    documentChunk: { count: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  prisma: fakes.prisma,
  toVectorLiteral: (values: number[]) => `[${values.join(",")}]`,
}));

import {
  PLANNING_QUERIES,
  selectPlanContext,
} from "@/lib/generation/context";
import type { GenerationSource } from "@/lib/generation/validate";

function chunk(documentId: string, chunkIndex: number): GenerationSource {
  return {
    id: `${documentId}-${chunkIndex}`,
    documentId,
    filename: `${documentId}.md`,
    content: `${documentId} content ${chunkIndex}`,
    chunkIndex,
    pageNumber: chunkIndex + 1,
    sectionTitle: `Section ${chunkIndex}`,
  };
}

const embeddings = {
  modelName: "fake/embedding",
  dimensions: 3,
  embed: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("selectPlanContext", () => {
  it("uses every selected chunk in reading order when the corpus fits in 48", async () => {
    const rows = [chunk("doc-a", 0), chunk("doc-a", 1), chunk("doc-b", 0)];
    fakes.prisma.documentChunk.count.mockResolvedValue(rows.length);
    fakes.prisma.$queryRaw.mockResolvedValue(rows);

    const selected = await selectPlanContext(
      "workspace-1",
      ["doc-a", "doc-b"],
      embeddings,
    );

    expect(selected.map((row) => row.id)).toEqual([
      "doc-a-0",
      "doc-a-1",
      "doc-b-0",
    ]);
    expect(embeddings.embed).not.toHaveBeenCalled();
    expect(fakes.prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("reserves each first chunk, caps each document at eight, and restores document reading order", async () => {
    const all = [
      ...Array.from({ length: 12 }, (_, index) => chunk("doc-a", index)),
      ...Array.from({ length: 12 }, (_, index) => chunk("doc-b", index)),
    ];
    const reserved = [chunk("doc-a", 0), chunk("doc-b", 0)];
    const vectorRows = all.map((row, index) => ({
      ...row,
      semanticScore: 0.99 - index / 100,
    }));

    fakes.prisma.documentChunk.count.mockResolvedValue(100);
    fakes.prisma.$queryRaw.mockResolvedValueOnce(reserved);
    for (let index = 0; index < PLANNING_QUERIES.length; index += 1) {
      fakes.prisma.$queryRaw.mockResolvedValueOnce(vectorRows);
      fakes.prisma.$queryRaw.mockResolvedValueOnce([]);
    }
    // The ranked lists cannot fill 48 without violating the per-document cap,
    // so the deterministic fallback query executes too.
    fakes.prisma.$queryRaw.mockResolvedValueOnce(all);
    embeddings.embed.mockResolvedValue(
      PLANNING_QUERIES.map(() => [0.1, 0.2, 0.3]),
    );

    const selected = await selectPlanContext(
      "workspace-1",
      ["doc-b", "doc-a"],
      embeddings,
    );

    expect(selected).toHaveLength(16);
    expect(selected.some((row) => row.id === "doc-a-0")).toBe(true);
    expect(selected.some((row) => row.id === "doc-b-0")).toBe(true);
    expect(selected.filter((row) => row.documentId === "doc-a")).toHaveLength(8);
    expect(selected.filter((row) => row.documentId === "doc-b")).toHaveLength(8);
    expect(selected.slice(0, 8).every((row) => row.documentId === "doc-b")).toBe(
      true,
    );
    expect(selected.slice(8).every((row) => row.documentId === "doc-a")).toBe(
      true,
    );
    for (const documentId of ["doc-a", "doc-b"]) {
      const indexes = selected
        .filter((row) => row.documentId === documentId)
        .map((row) => row.chunkIndex);
      expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
    }
  });
});
