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

/**
 * A JWT outlives the row it names: a reset database, a deleted account, or a
 * cookie from a server pointed at a different database all leave a valid
 * signature for a user who is not there. Treated as signed in, that user
 * reached workspace provisioning and crashed every page on a foreign-key
 * violation; treated as signed out, they land on the sign-in form, whose next
 * sign-in replaces the cookie. Cached so a request pays for one lookup.
 *
 * The same read carries the person's preferences, so the language and time
 * zone every page needs cost no second query.
 */
const getUserRow = cache(async function getUserRow(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: { id: true, locale: true, timeZone: true, activeWorkspaceId: true },
  });
});

export interface UserPreferences {
  locale: string;
  timeZone: string;
}

/** The signed-in person's saved language and time zone, or null if no such user. */
export async function getUserPreferences(
  id: string,
): Promise<UserPreferences | null> {
  const user = await getUserRow(id);
  return user ? { locale: user.locale, timeZone: user.timeZone } : null;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  if (!(await getUserRow(id))) return null;
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
 * The workspace a request acts in. In order:
 *
 * 1. The one the person last chose (`User.activeWorkspaceId`) — but only while
 *    they are still a member of it. A stale choice is ignored, never trusted:
 *    the column is a preference, membership is the permission.
 * 2. Their earliest membership.
 * 3. A new workspace with them as admin, created on first use.
 *
 * Accepting an invite sets (1), so someone who already had a workspace lands
 * in the team's instead of the one they created on sign-up.
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

  const row = await getUserRow(userId);
  const activeWorkspaceId = row?.activeWorkspaceId;
  if (activeWorkspaceId) {
    const active = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: activeWorkspaceId, userId } },
      include: { workspace: { select: { name: true } } },
    });
    if (active) {
      return {
        workspaceId: active.workspaceId,
        workspaceName: active.workspace.name,
        userId,
        role: active.role,
      };
    }
  }

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

  const name = defaultWorkspaceName(user.name, row?.locale);
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
 * A first workspace is named in the person's language, as their personal
 * project is; anything but English reads Chinese, since that is the default.
 */
export function defaultWorkspaceName(name: string | null, locale: string | undefined): string {
  const who = name?.trim();
  if (locale === "en") return who ? `${who}'s Workspace` : "My Workspace";
  return who ? `${who}的工作區` : "我的工作區";
}

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

/** Every workspace the person belongs to, for the workspace switcher. */
export async function listMemberships(userId: string) {
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { role: true, workspace: { select: { id: true, name: true } } },
  });
  return memberships.map((membership) => ({
    id: membership.workspace.id,
    name: membership.workspace.name,
    role: membership.role,
  }));
}
