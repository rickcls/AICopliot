import "server-only";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { WorkspaceRole } from "@/generated/prisma/enums";

/**
 * Workspace isolation.
 *
 * Rule for the whole codebase: no query touches workspace-scoped data until
 * requireWorkspaceAccess has resolved, and every such query filters on the
 * returned workspaceId. Single-record reads use findFirst({ id, workspaceId })
 * rather than findUnique({ id }), so a document ID belonging to another
 * workspace simply does not resolve.
 */

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 | 404,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  return {
    id,
    email: session.user?.email ?? "",
    name: session.user?.name ?? null,
  };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError("You must be signed in", 401);
  return user;
}

export interface WorkspaceAccess {
  workspaceId: string;
  workspaceName: string;
  userId: string;
  role: WorkspaceRole;
}

/**
 * Resolves the caller's membership of a specific workspace, or throws.
 * Membership is the only thing that grants access — ownership alone does not,
 * because owners are always inserted as members too.
 */
export async function requireWorkspaceAccess(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceAccess> {
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    include: { workspace: { select: { name: true } } },
  });

  if (!membership) {
    // 404 rather than 403: don't confirm that a workspace ID exists to someone
    // who isn't a member.
    throw new AuthError("Workspace not found", 404);
  }

  return {
    workspaceId,
    workspaceName: membership.workspace.name,
    userId,
    role: membership.role,
  };
}

export function requireAdmin(access: WorkspaceAccess): WorkspaceAccess {
  if (access.role !== "admin") {
    throw new AuthError("Administrator access required", 403);
  }
  return access;
}

/**
 * Single-workspace MVP: every user gets one workspace, created on first use.
 * Returns the caller's existing membership if there is one.
 */
export async function getOrCreateDefaultWorkspace(
  user: SessionUser,
): Promise<WorkspaceAccess> {
  const existing = await prisma.workspaceMember.findFirst({
    where: { userId: user.id },
    include: { workspace: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  if (existing) {
    return {
      workspaceId: existing.workspaceId,
      workspaceName: existing.workspace.name,
      userId: user.id,
      role: existing.role,
    };
  }

  const name = user.name ? `${user.name}'s Workspace` : "My Workspace";
  const workspace = await prisma.workspace.create({
    data: {
      name,
      ownerId: user.id,
      members: { create: { userId: user.id, role: "admin" } },
    },
  });

  return {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    userId: user.id,
    role: "admin",
  };
}

/** Convenience for routes/pages: authenticate and resolve the workspace. */
export async function requireWorkspace(): Promise<
  WorkspaceAccess & { user: SessionUser }
> {
  const user = await requireUser();
  const access = await getOrCreateDefaultWorkspace(user);
  return { ...access, user };
}
