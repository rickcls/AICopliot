import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canChangeMember,
  generateInviteToken,
  hashInviteToken,
  inviteExpiry,
  inviteState,
  INVITE_TTL_DAYS,
} from "@/lib/workspace/invites";

/**
 * Invite links and member changes. The pure rules first; then the service
 * against a mocked Prisma, where what matters is the *shape* of each query —
 * lookups by hash, claims that are conditional, writes scoped to the
 * workspace.
 */

const NOW = new Date("2026-10-16T08:00:00Z");

describe("invite tokens", () => {
  it("are 32 random bytes in base64url, different every time", () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("hash deterministically, and the hash is not the token", () => {
    const token = generateInviteToken();
    expect(hashInviteToken(token)).toBe(hashInviteToken(token));
    expect(hashInviteToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(token)).not.toContain(token);
  });

  it("expire after the TTL", () => {
    expect(inviteExpiry(NOW).getTime() - NOW.getTime()).toBe(
      INVITE_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
  });
});

describe("inviteState", () => {
  const base = { expiresAt: new Date("2026-10-20T00:00:00Z"), acceptedAt: null, revokedAt: null };

  it("is valid before expiry while unused", () => {
    expect(inviteState(base, NOW)).toBe("valid");
  });

  it("is expired at the expiry instant", () => {
    expect(inviteState(base, base.expiresAt)).toBe("expired");
  });

  it("prefers revoked, then accepted, over expired", () => {
    const late = new Date("2026-11-01T00:00:00Z");
    expect(inviteState({ ...base, acceptedAt: NOW }, late)).toBe("accepted");
    expect(inviteState({ ...base, acceptedAt: NOW, revokedAt: NOW }, late)).toBe("revoked");
  });
});

describe("canChangeMember", () => {
  const admin = { userId: "a", role: "admin" as const };
  const member = { userId: "m", role: "member" as const };
  const target = (role: "admin" | "member", isOwner = false, userId = "t") => ({
    userId,
    role,
    isOwner,
  });

  it("lets an admin remove or re-role an ordinary member", () => {
    expect(
      canChangeMember({ actor: admin, target: target("member"), adminCount: 1, change: { kind: "remove" } }),
    ).toEqual({ ok: true });
    expect(
      canChangeMember({
        actor: admin,
        target: target("member"),
        adminCount: 1,
        change: { kind: "role", role: "admin" },
      }),
    ).toEqual({ ok: true });
  });

  it("refuses a member changing anyone else", () => {
    expect(
      canChangeMember({ actor: member, target: target("member"), adminCount: 1, change: { kind: "remove" } }),
    ).toEqual({ ok: false, reason: "not_admin" });
  });

  it("lets a member leave on their own", () => {
    expect(
      canChangeMember({
        actor: member,
        target: target("member", false, "m"),
        adminCount: 1,
        change: { kind: "remove" },
      }),
    ).toEqual({ ok: true });
  });

  it("never removes or demotes the owner", () => {
    expect(
      canChangeMember({ actor: admin, target: target("admin", true), adminCount: 3, change: { kind: "remove" } }),
    ).toEqual({ ok: false, reason: "owner" });
    expect(
      canChangeMember({
        actor: admin,
        target: target("admin", true),
        adminCount: 3,
        change: { kind: "role", role: "member" },
      }),
    ).toEqual({ ok: false, reason: "owner" });
  });

  it("keeps at least one admin", () => {
    expect(
      canChangeMember({
        actor: admin,
        target: target("admin", false, "a"),
        adminCount: 1,
        change: { kind: "role", role: "member" },
      }),
    ).toEqual({ ok: false, reason: "last_admin" });
    expect(
      canChangeMember({
        actor: admin,
        target: target("admin", false, "a"),
        adminCount: 2,
        change: { kind: "remove" },
      }),
    ).toEqual({ ok: true });
  });
});

// --- Service ----------------------------------------------------------------

const tx = {
  workspaceInvite: { updateMany: vi.fn() },
  workspaceMember: { create: vi.fn() },
  user: { update: vi.fn() },
};
const mockPrisma = {
  workspaceInvite: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  workspaceMember: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  workspace: { findUniqueOrThrow: vi.fn() },
  project: { updateMany: vi.fn() },
  user: { update: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (t: typeof tx) => unknown)(tx) : arg,
  ),
};

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("server-only", () => ({}));

const { AuthError } = await import("@/lib/auth-guard");
const service = await import("@/lib/workspace/service");

const adminAccess = { workspaceId: "ws-1", workspaceName: "Ops", userId: "u-admin", role: "admin" as const };
const memberAccess = { ...adminAccess, userId: "u-member", role: "member" as const };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createInvite", () => {
  it("stores only the hash and returns the raw token once", async () => {
    mockPrisma.workspaceInvite.create.mockResolvedValue({ id: "inv-1" });

    const { token } = await service.createInvite(adminAccess, "member", NOW);

    const data = mockPrisma.workspaceInvite.create.mock.calls[0][0].data;
    expect(data.tokenHash).toBe(hashInviteToken(token));
    expect(JSON.stringify(data)).not.toContain(token);
    expect(data).toMatchObject({ workspaceId: "ws-1", role: "member", createdById: "u-admin" });
  });

  it("refuses a non-admin with 403", async () => {
    await expect(service.createInvite(memberAccess, "member", NOW)).rejects.toMatchObject({
      status: 403,
    });
    expect(mockPrisma.workspaceInvite.create).not.toHaveBeenCalled();
  });
});

describe("revokeInvite", () => {
  it("only matches an unused invite in the caller's workspace", async () => {
    mockPrisma.workspaceInvite.updateMany.mockResolvedValue({ count: 0 });

    expect(await service.revokeInvite(adminAccess, "inv-x", NOW)).toBe(false);
    expect(mockPrisma.workspaceInvite.updateMany.mock.calls[0][0].where).toEqual({
      id: "inv-x",
      workspaceId: "ws-1",
      acceptedAt: null,
      revokedAt: null,
    });
  });
});

describe("acceptInvite", () => {
  const valid = {
    id: "inv-1",
    workspaceId: "ws-team",
    role: "member",
    expiresAt: new Date("2026-10-20T00:00:00Z"),
    acceptedAt: null,
    revokedAt: null,
  };

  it("looks the invite up by the token's hash, never the token", async () => {
    mockPrisma.workspaceInvite.findUnique.mockResolvedValue(null);

    await expect(service.acceptInvite("u-new", "raw-token-value-123456", NOW)).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
    expect(mockPrisma.workspaceInvite.findUnique.mock.calls[0][0].where).toEqual({
      tokenHash: hashInviteToken("raw-token-value-123456"),
    });
  });

  it("claims the invite conditionally, then adds the member and switches to the workspace", async () => {
    mockPrisma.workspaceInvite.findUnique.mockResolvedValue(valid);
    mockPrisma.workspaceMember.findUnique.mockResolvedValue(null);
    tx.workspaceInvite.updateMany.mockResolvedValue({ count: 1 });

    expect(await service.acceptInvite("u-new", "token", NOW)).toEqual({ workspaceId: "ws-team" });

    expect(tx.workspaceInvite.updateMany).toHaveBeenCalledWith({
      where: { id: "inv-1", acceptedAt: null, revokedAt: null, expiresAt: { gt: NOW } },
      data: { acceptedAt: NOW, acceptedById: "u-new" },
    });
    expect(tx.workspaceMember.create).toHaveBeenCalledWith({
      data: { workspaceId: "ws-team", userId: "u-new", role: "member" },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "u-new" },
      data: { activeWorkspaceId: "ws-team" },
    });
  });

  it("lets only one of two simultaneous accepts in", async () => {
    mockPrisma.workspaceInvite.findUnique.mockResolvedValue(valid);
    mockPrisma.workspaceMember.findUnique.mockResolvedValue(null);
    tx.workspaceInvite.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.acceptInvite("u-late", "token", NOW)).rejects.toMatchObject({
      code: "accepted",
    });
    expect(tx.workspaceMember.create).not.toHaveBeenCalled();
  });

  it("refuses an expired or withdrawn link before writing anything", async () => {
    mockPrisma.workspaceMember.findUnique.mockResolvedValue(null);

    mockPrisma.workspaceInvite.findUnique.mockResolvedValue({
      ...valid,
      expiresAt: new Date("2026-10-01T00:00:00Z"),
    });
    await expect(service.acceptInvite("u", "token", NOW)).rejects.toMatchObject({ status: 410 });

    mockPrisma.workspaceInvite.findUnique.mockResolvedValue({ ...valid, revokedAt: NOW });
    await expect(service.acceptInvite("u", "token", NOW)).rejects.toMatchObject({ code: "revoked" });

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("switches an existing member without using up the link", async () => {
    mockPrisma.workspaceInvite.findUnique.mockResolvedValue(valid);
    mockPrisma.workspaceMember.findUnique.mockResolvedValue({ userId: "u-old" });

    await service.acceptInvite("u-old", "token", NOW);

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "u-old" },
      data: { activeWorkspaceId: "ws-team" },
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("changeMember", () => {
  function setup(target: { userId: string; role: "admin" | "member" } | null, ownerId = "u-owner", admins = 2) {
    mockPrisma.workspaceMember.findUnique.mockResolvedValue(target);
    mockPrisma.workspace.findUniqueOrThrow.mockResolvedValue({ ownerId });
    mockPrisma.workspaceMember.count.mockResolvedValue(admins);
  }

  it("removes a member and hands their personal project back to the team", async () => {
    setup({ userId: "u-gone", role: "member" });

    await service.changeMember(adminAccess, "u-gone", { kind: "remove" });

    expect(mockPrisma.workspaceMember.delete).toHaveBeenCalledWith({
      where: { workspaceId_userId: { workspaceId: "ws-1", userId: "u-gone" } },
    });
    expect(mockPrisma.project.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1", personalOwnerId: "u-gone" },
      data: { personalOwnerId: null },
    });
  });

  it("refuses to remove the owner", async () => {
    setup({ userId: "u-owner", role: "admin" });

    await expect(
      service.changeMember(adminAccess, "u-owner", { kind: "remove" }),
    ).rejects.toBeInstanceOf(AuthError);
    expect(mockPrisma.workspaceMember.delete).not.toHaveBeenCalled();
  });

  it("returns 404 for someone who is not a member of this workspace", async () => {
    setup(null);

    await expect(
      service.changeMember(adminAccess, "u-elsewhere", { kind: "role", role: "admin" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("looks the target up inside the caller's workspace", async () => {
    setup({ userId: "u-2", role: "member" });

    await service.changeMember(adminAccess, "u-2", { kind: "role", role: "admin" });

    expect(mockPrisma.workspaceMember.findUnique.mock.calls[0][0].where).toEqual({
      workspaceId_userId: { workspaceId: "ws-1", userId: "u-2" },
    });
  });
});
