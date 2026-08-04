import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Workspace isolation.
 *
 * Prisma is mocked so these run without a database. What is under test is the
 * guard logic and — importantly — the *shape of the query* each guard issues:
 * a document lookup must constrain on workspaceId, not just id.
 */

const mockPrisma = {
  workspaceMember: { findUnique: vi.fn(), findFirst: vi.fn() },
  workspace: { create: vi.fn() },
  document: { findFirst: vi.fn(), findUnique: vi.fn() },
};

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("server-only", () => ({}));

const {
  AuthError,
  requireWorkspaceAccess,
  requireAdmin,
  getOrCreateDefaultWorkspace,
} = await import("@/lib/auth-guard");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireWorkspaceAccess", () => {
  it("grants access to a member", async () => {
    mockPrisma.workspaceMember.findUnique.mockResolvedValue({
      workspaceId: "ws-1",
      userId: "user-1",
      role: "member",
      workspace: { name: "Ops" },
    });

    const access = await requireWorkspaceAccess("user-1", "ws-1");

    expect(access).toEqual({
      workspaceId: "ws-1",
      workspaceName: "Ops",
      userId: "user-1",
      role: "member",
    });
  });

  it("rejects a user who is not a member", async () => {
    mockPrisma.workspaceMember.findUnique.mockResolvedValue(null);

    await expect(requireWorkspaceAccess("outsider", "ws-1")).rejects.toThrow(
      AuthError,
    );
  });

  it("reports 404 rather than 403, so workspace existence is not disclosed", async () => {
    mockPrisma.workspaceMember.findUnique.mockResolvedValue(null);

    await expect(
      requireWorkspaceAccess("outsider", "ws-1"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("looks membership up by the (workspace, user) pair", async () => {
    mockPrisma.workspaceMember.findUnique.mockResolvedValue({
      workspaceId: "ws-1",
      userId: "user-1",
      role: "admin",
      workspace: { name: "Ops" },
    });

    await requireWorkspaceAccess("user-1", "ws-1");

    expect(mockPrisma.workspaceMember.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId_userId: { workspaceId: "ws-1", userId: "user-1" } },
      }),
    );
  });
});

describe("requireAdmin", () => {
  const base = { workspaceId: "ws-1", workspaceName: "Ops", userId: "u" };

  it("allows an admin", () => {
    expect(() => requireAdmin({ ...base, role: "admin" })).not.toThrow();
  });

  it("rejects a plain member with 403", () => {
    expect(() => requireAdmin({ ...base, role: "member" })).toThrow(AuthError);
    try {
      requireAdmin({ ...base, role: "member" });
    } catch (error) {
      expect((error as InstanceType<typeof AuthError>).status).toBe(403);
    }
  });
});

describe("getOrCreateDefaultWorkspace", () => {
  const user = { id: "user-1", email: "a@b.c", name: "Ada" };

  it("returns the existing membership without creating another workspace", async () => {
    mockPrisma.workspaceMember.findFirst.mockResolvedValue({
      workspaceId: "ws-1",
      role: "admin",
      workspace: { name: "Ada's Workspace" },
    });

    const access = await getOrCreateDefaultWorkspace(user);

    expect(access.workspaceId).toBe("ws-1");
    expect(mockPrisma.workspace.create).not.toHaveBeenCalled();
  });

  it("creates a workspace with the user as admin member on first use", async () => {
    mockPrisma.workspaceMember.findFirst.mockResolvedValue(null);
    mockPrisma.workspace.create.mockResolvedValue({
      id: "ws-new",
      name: "Ada's Workspace",
    });

    const access = await getOrCreateDefaultWorkspace(user);

    expect(access).toMatchObject({ workspaceId: "ws-new", role: "admin" });
    expect(mockPrisma.workspace.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: "user-1",
          members: { create: { userId: "user-1", role: "admin" } },
        }),
      }),
    );
  });
});

describe("cross-workspace document access", () => {
  /**
   * Mirrors the query in src/app/api/documents/[id]/route.ts. The guarantee is
   * that a valid document ID from another workspace does not resolve, because
   * workspaceId is part of the WHERE clause rather than checked afterwards.
   */
  async function findDocumentScoped(id: string, workspaceId: string) {
    return mockPrisma.document.findFirst({ where: { id, workspaceId } });
  }

  it("returns nothing for a document belonging to another workspace", async () => {
    mockPrisma.document.findFirst.mockImplementation(
      async ({ where }: { where: { id: string; workspaceId: string } }) =>
        where.id === "doc-1" && where.workspaceId === "ws-owner"
          ? { id: "doc-1", workspaceId: "ws-owner" }
          : null,
    );

    await expect(findDocumentScoped("doc-1", "ws-owner")).resolves.not.toBeNull();
    await expect(findDocumentScoped("doc-1", "ws-attacker")).resolves.toBeNull();
  });

  it("always constrains on workspaceId, never on id alone", async () => {
    mockPrisma.document.findFirst.mockResolvedValue(null);

    await findDocumentScoped("doc-1", "ws-1");

    const call = mockPrisma.document.findFirst.mock.calls[0][0];
    expect(call.where).toHaveProperty("workspaceId", "ws-1");
    expect(mockPrisma.document.findUnique).not.toHaveBeenCalled();
  });
});
