import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";

/**
 * Scoped project lookup shared by the project layout and its tab pages.
 *
 * Layouts cannot pass data to their children, so both would otherwise issue the
 * same query on every render. React `cache` dedupes them within one request
 * without either side knowing about the other.
 */
export const getScopedProject = cache(
  async (workspaceId: string, projectId: string) =>
    prisma.project.findFirst({
      where: { id: projectId, workspaceId },
      select: { id: true, name: true, description: true },
    }),
);

/** Workspace members offered as task assignees. */
export const getAssignableMembers = cache(async (workspaceId: string) => {
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    select: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });

  return members.map(({ user }) => ({
    id: user.id,
    name: user.name ?? user.email,
  }));
});
