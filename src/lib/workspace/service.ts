import "server-only";
import type { WorkspaceRole } from "@/generated/prisma/enums";
import { AuthError, requireAdmin, type WorkspaceAccess } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import {
  canChangeMember,
  generateInviteToken,
  hashInviteToken,
  inviteExpiry,
  inviteState,
  type MemberChange,
} from "@/lib/workspace/invites";

/**
 * Inviting colleagues and managing who belongs to a workspace.
 *
 * Every function that acts on a workspace takes an already-resolved
 * `WorkspaceAccess`, so membership was checked before any of this runs, and
 * every query constrains on that workspace id (invariant 1). Accepting an
 * invite is the one exception: the person is not a member yet, and the token
 * is what authorises them.
 */

export class InviteError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "expired" | "accepted" | "revoked",
    readonly status: 404 | 409 | 410,
  ) {
    super(message);
    this.name = "InviteError";
  }
}

function unusableInvite(state: "expired" | "accepted" | "revoked"): InviteError {
  switch (state) {
    case "expired":
      return new InviteError("This invite link has expired", "expired", 410);
    case "accepted":
      return new InviteError("This invite link has already been used", "accepted", 409);
    case "revoked":
      return new InviteError("This invite link was withdrawn", "revoked", 410);
  }
}

/** Creates a link. The raw token is returned here once and never stored. */
export async function createInvite(
  access: WorkspaceAccess,
  role: WorkspaceRole,
  now: Date = new Date(),
) {
  requireAdmin(access);
  const token = generateInviteToken();
  const invite = await prisma.workspaceInvite.create({
    data: {
      workspaceId: access.workspaceId,
      tokenHash: hashInviteToken(token),
      role,
      createdById: access.userId,
      expiresAt: inviteExpiry(now),
    },
    select: { id: true, role: true, expiresAt: true, createdAt: true },
  });
  return { invite, token };
}

/** Links still waiting to be used. Never includes a token: none is stored. */
export async function listPendingInvites(
  access: WorkspaceAccess,
  now: Date = new Date(),
) {
  requireAdmin(access);
  return prisma.workspaceInvite.findMany({
    where: {
      workspaceId: access.workspaceId,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, role: true, expiresAt: true, createdAt: true },
  });
}

/** Withdraws a link that has not been used. Returns false if there was none. */
export async function revokeInvite(
  access: WorkspaceAccess,
  inviteId: string,
  now: Date = new Date(),
): Promise<boolean> {
  requireAdmin(access);
  const { count } = await prisma.workspaceInvite.updateMany({
    where: {
      id: inviteId,
      workspaceId: access.workspaceId,
      acceptedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: now },
  });
  return count > 0;
}

/** What the invite page shows before anyone accepts: the workspace and the state. */
export async function describeInvite(token: string, now: Date = new Date()) {
  const invite = await prisma.workspaceInvite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: {
      workspaceId: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      workspace: { select: { name: true } },
    },
  });
  if (!invite) return null;
  return {
    workspaceId: invite.workspaceId,
    workspaceName: invite.workspace.name,
    role: invite.role,
    state: inviteState(invite, now),
  };
}

/**
 * Joins the signed-in person to the invite's workspace and makes it their
 * active one.
 *
 * The link is single-use, and two people opening it at once must not both get
 * in: the invite is claimed with a conditional update inside the same
 * transaction as the membership insert, so only one claim can see count 1.
 * Someone who is already a member just switches to the workspace, and the link
 * stays unused for the person it was meant for.
 */
export async function acceptInvite(
  userId: string,
  token: string,
  now: Date = new Date(),
): Promise<{ workspaceId: string }> {
  const invite = await prisma.workspaceInvite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: {
      id: true,
      workspaceId: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
    },
  });
  if (!invite) {
    throw new InviteError("This invite link is not valid", "not_found", 404);
  }

  const existing = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId } },
    select: { userId: true },
  });
  if (existing) {
    await prisma.user.update({
      where: { id: userId },
      data: { activeWorkspaceId: invite.workspaceId },
    });
    return { workspaceId: invite.workspaceId };
  }

  const state = inviteState(invite, now);
  if (state !== "valid") throw unusableInvite(state);

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.workspaceInvite.updateMany({
      where: {
        id: invite.id,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { acceptedAt: now, acceptedById: userId },
    });
    if (claimed.count === 0) throw unusableInvite("accepted");

    await tx.workspaceMember.create({
      data: { workspaceId: invite.workspaceId, userId, role: invite.role },
    });
    await tx.user.update({
      where: { id: userId },
      data: { activeWorkspaceId: invite.workspaceId },
    });
  });

  return { workspaceId: invite.workspaceId };
}

export async function listMembers(workspaceId: string) {
  const [workspace, members] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { ownerId: true },
    }),
    prisma.workspaceMember.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
      select: {
        role: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);

  return members.map((member) => ({
    userId: member.user.id,
    name: member.user.name,
    email: member.user.email,
    role: member.role,
    isOwner: member.user.id === workspace.ownerId,
    joinedAt: member.createdAt,
  }));
}

/**
 * Changes a member's role or removes them, after `canChangeMember` agrees.
 *
 * Removing someone hands their personal project in this workspace back to the
 * team as an ordinary project: left as it was, it would be hidden from every
 * remaining member's navigation (only its owner could see it) while still
 * holding work nobody could find.
 */
export async function changeMember(
  access: WorkspaceAccess,
  targetUserId: string,
  change: MemberChange,
) {
  const [target, workspace, adminCount] = await Promise.all([
    prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: access.workspaceId, userId: targetUserId },
      },
      select: { userId: true, role: true },
    }),
    prisma.workspace.findUniqueOrThrow({
      where: { id: access.workspaceId },
      select: { ownerId: true },
    }),
    prisma.workspaceMember.count({
      where: { workspaceId: access.workspaceId, role: "admin" },
    }),
  ]);
  if (!target) throw new AuthError("Member not found", 404);

  const check = canChangeMember({
    actor: { userId: access.userId, role: access.role },
    target: { ...target, isOwner: target.userId === workspace.ownerId },
    adminCount,
    change,
  });
  if (!check.ok) {
    throw new AuthError(
      check.reason === "not_admin"
        ? "Administrator access required"
        : check.reason === "owner"
          ? "The workspace owner cannot be removed or made a member"
          : "A workspace needs at least one administrator",
      403,
    );
  }

  if (change.kind === "role") {
    await prisma.workspaceMember.update({
      where: {
        workspaceId_userId: { workspaceId: access.workspaceId, userId: targetUserId },
      },
      data: { role: change.role },
    });
    return;
  }

  await prisma.$transaction([
    prisma.workspaceMember.delete({
      where: {
        workspaceId_userId: { workspaceId: access.workspaceId, userId: targetUserId },
      },
    }),
    prisma.project.updateMany({
      where: { workspaceId: access.workspaceId, personalOwnerId: targetUserId },
      data: { personalOwnerId: null },
    }),
    prisma.user.updateMany({
      where: { id: targetUserId, activeWorkspaceId: access.workspaceId },
      data: { activeWorkspaceId: null },
    }),
  ]);
}
