import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { officialRecordWhere } from "@/lib/pm/rules";

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

/** Official milestones offered by normal task/risk forms. */
export const getProjectMilestoneOptions = cache(
  async (workspaceId: string, projectId: string) =>
    prisma.milestone.findMany({
      where: officialRecordWhere({ workspaceId, projectId }),
      orderBy: [{ targetDate: "asc" }, { createdAt: "asc" }],
      select: { id: true, title: true },
    }),
);

/**
 * Resolve a normal-form milestone link inside the caller's workspace/project.
 * Draft and rejected proposals are deliberately invisible here; links to them
 * are created only inside the generation review transaction.
 */
export async function findOfficialProjectMilestone(
  workspaceId: string,
  projectId: string,
  milestoneId: string,
) {
  return prisma.milestone.findFirst({
    where: officialRecordWhere({ id: milestoneId, workspaceId, projectId }),
    select: { id: true, title: true },
  });
}
