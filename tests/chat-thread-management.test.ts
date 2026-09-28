import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Thread rename/delete must be unable to touch anyone else's conversation.
 * Prisma is mocked; what is under test is the shape of the write — the
 * (id, workspace, user) triple must be *in* the where clause, so a foreign id
 * matches nothing rather than being checked after the fact.
 */

const mockPrisma = {
  chatConversation: { updateMany: vi.fn(), deleteMany: vi.fn() },
};

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("server-only", () => ({}));

const { deleteConversation, renameConversation } = await import(
  "@/lib/chat/history"
);
const { renameConversationSchema } = await import("@/lib/schemas");

beforeEach(() => vi.clearAllMocks());

describe("renameConversation", () => {
  it("scopes the write by id, workspace, and user", async () => {
    mockPrisma.chatConversation.updateMany.mockResolvedValue({ count: 1 });
    await expect(renameConversation("ws-1", "u-1", "c-1", "Onboarding")).resolves.toBe(
      true,
    );
    expect(mockPrisma.chatConversation.updateMany).toHaveBeenCalledWith({
      where: { id: "c-1", workspaceId: "ws-1", userId: "u-1" },
      data: { title: "Onboarding" },
    });
  });

  it("reports false when the thread belongs to someone else", async () => {
    mockPrisma.chatConversation.updateMany.mockResolvedValue({ count: 0 });
    await expect(renameConversation("ws-1", "intruder", "c-1", "x")).resolves.toBe(
      false,
    );
  });
});

describe("deleteConversation", () => {
  it("scopes the delete by id, workspace, and user", async () => {
    mockPrisma.chatConversation.deleteMany.mockResolvedValue({ count: 1 });
    await expect(deleteConversation("ws-1", "u-1", "c-1")).resolves.toBe(true);
    expect(mockPrisma.chatConversation.deleteMany).toHaveBeenCalledWith({
      where: { id: "c-1", workspaceId: "ws-1", userId: "u-1" },
    });
  });

  it("reports false when nothing matched", async () => {
    mockPrisma.chatConversation.deleteMany.mockResolvedValue({ count: 0 });
    await expect(deleteConversation("ws-2", "u-1", "c-1")).resolves.toBe(false);
  });
});

describe("renameConversationSchema", () => {
  it("trims, and rejects a blank or oversized title", () => {
    expect(renameConversationSchema.parse({ title: "  Q3 scope  " }).title).toBe(
      "Q3 scope",
    );
    expect(renameConversationSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(
      renameConversationSchema.safeParse({ title: "x".repeat(121) }).success,
    ).toBe(false);
  });
});
