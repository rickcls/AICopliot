import "server-only";
import { cache } from "react";
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
 *
 * The app layout, the project layout, and the page each resolve the workspace,
 * and layouts cannot hand it down. React `cache` makes that one lookup per
 * request. It is keyed on primitives because `cache` compares arguments by
 * identity, so a `user` object would never hit.
 */
export function getOrCreateDefaultWorkspace(
  user: SessionUser,
): Promise<WorkspaceAccess> {
  return defaultWorkspaceFor(user.id, user.name);
}

const defaultWorkspaceFor = cache(async function defaultWorkspaceFor(
  userId: string,
  userName: string | null,
): Promise<WorkspaceAccess> {
  const user = { id: userId, name: userName };
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
});

/**
 * Resolves a client-supplied project ID *within* an already-authorised
 * workspace, or throws. A projectId from the request body is never trusted on
 * its own — the (id, workspaceId) pair is the lookup, so an ID belonging to
 * another workspace simply does not resolve.
 *
 * 404 rather than 403, for the same reason as requireWorkspaceAccess: don't
 * confirm that a project exists to someone who cannot see it.
 */
export async function requireProject(
  workspaceId: string,
  projectId: string,
): Promise<{ id: string; name: string }> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, workspaceId },
    select: { id: true, name: true },
  });

  if (!project) throw new AuthError("Project not found", 404);
  return project;
}

/**
 * Confirms an assignee is a member of this workspace before their ID is
 * written to a task, so a user ID from outside the workspace cannot be attached
 * to its work.
 */
export async function requireWorkspaceMember(
  workspaceId: string,
  userId: string,
): Promise<string> {
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { userId: true },
  });

  if (!membership) throw new AuthError("Assignee is not a workspace member", 404);
  return membership.userId;
}

/** Convenience for routes/pages: authenticate and resolve the workspace. */
export async function requireWorkspace(): Promise<
  WorkspaceAccess & { user: SessionUser }
> {
  const user = await requireUser();
  const access = await getOrCreateDefaultWorkspace(user);
  return { ...access, user };
}
