import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";
import {
  OPEN_TASK_CATEGORIES,
  assignedTo,
  officialRecordWhere,
} from "@/lib/pm/rules";

/**
 * A ceiling, not a page size: one person's open work across every project is
 * tens of tasks. It exists so a runaway import cannot make Today unbounded.
 */
const MY_OPEN_TASK_LIMIT = 500;

/**
 * Whether this workspace has a single member. In that case "my work" includes
 * unassigned tasks, because there is no one else they could belong to.
 */
export const isSoloWorkspace = cache(async (workspaceId: string) => {
  const members = await prisma.workspaceMember.count({ where: { workspaceId } });
  return members <= 1;
});

/** The viewer's open official tasks across every project in the workspace. */
export async function getMyOpenTasks(workspaceId: string, userId: string) {
  const includeUnassigned = await isSoloWorkspace(workspaceId);

  return prisma.task.findMany({
    where: assignedTo(
      userId,
      officialRecordWhere({
        workspaceId,
        status: { category: { in: [...OPEN_TASK_CATEGORIES] } },
      }),
      { includeUnassigned },
    ),
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    take: MY_OPEN_TASK_LIMIT,
    select: {
      id: true,
      title: true,
      dueDate: true,
      priority: true,
      estimatedHours: true,
      updatedAt: true,
      status: { select: { key: true, label: true, category: true } },
      project: { select: { id: true, name: true } },
      // For the needs-an-update rule: the newest comment by anyone, and this
      // person's own snooze (another member's snooze is theirs alone).
      comments: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      snoozes: { where: { userId }, select: { until: true } },
    },
  });
}

/** The fields `isStale` reads, from a row of `getMyOpenTasks`. */
export function activityOf(task: MyOpenTask) {
  return {
    open: true,
    updatedAt: task.updatedAt,
    lastCommentAt: task.comments[0]?.createdAt ?? null,
    snoozedUntil: task.snoozes[0]?.until ?? null,
  };
}

export type MyOpenTask = Awaited<ReturnType<typeof getMyOpenTasks>>[number];
