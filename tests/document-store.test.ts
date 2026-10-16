import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = {
  document: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
};
const storage = { put: vi.fn(), get: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ MAX_UPLOAD_BYTES: 1024 }) }));
vi.mock("@/lib/storage", () => ({ getStorage: () => storage }));

const { storeDocument } = await import("@/lib/documents/store");

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.document.create.mockResolvedValue({ id: "doc-1", mimeType: "text/markdown" });
});

describe("storeDocument", () => {
  it("keys storage by workspace and document id, never by the filename", async () => {
    const result = await storeDocument({
      workspaceId: "ws-1",
      projectId: "p1",
      filename: "../../etc/note.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# hello"),
    });

    expect(result).toEqual({ ok: true, id: "doc-1" });
    expect(storage.put.mock.calls[0][0]).toBe("ws-1/doc-1.md");
    expect(mockPrisma.document.update).toHaveBeenCalledWith({
      where: { id: "doc-1" },
      data: { storageKey: "ws-1/doc-1.md" },
    });
  });

  it("refuses a file whose bytes do not match its type, before creating a row", async () => {
    const result = await storeDocument({
      workspaceId: "ws-1",
      projectId: null,
      filename: "fake.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("not really a pdf"),
    });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(mockPrisma.document.create).not.toHaveBeenCalled();
  });

  it("refuses an oversized file", async () => {
    const result = await storeDocument({
      workspaceId: "ws-1",
      projectId: null,
      filename: "big.txt",
      mimeType: "text/plain",
      buffer: Buffer.alloc(2048, 97),
    });
    expect(result).toMatchObject({ ok: false, status: 413 });
  });

  it("removes the row when the storage write fails", async () => {
    storage.put.mockRejectedValueOnce(new Error("disk full"));
    await expect(
      storeDocument({
        workspaceId: "ws-1",
        projectId: null,
        filename: "a.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("hello"),
      }),
    ).rejects.toThrow("disk full");
    expect(mockPrisma.document.delete).toHaveBeenCalledWith({ where: { id: "doc-1" } });
  });
});
