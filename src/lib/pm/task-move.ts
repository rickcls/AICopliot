import "server-only";
import type { WorkspaceAccess } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import {
  completedAtOnStatusChange,
  DONE_TASK_CATEGORY,
  officialRecordWhere,
} from "@/lib/pm/rules";
import { taskSelect } from "@/lib/pm/select";
import { pickStatusForMove } from "@/lib/pm/status-pick";
import { visibleProjectWhere } from "@/lib/pm/visibility";

/**
 * Moving official tasks into another project, in one transaction.
 *
 * A task is filed where it was created — a capture's work lands in the
 * personal project, a plan's in the project it was drafted for — and often
 * belongs somewhere else. What it carries is decided by what belongs to a
 * project and what belongs to the task:
 *
 * - **Kept:** its fields, notes, sources, and linked documents. A document
 *   stays filed where it is and the link survives, because moving the file
 *   would take it from every other task and from the project chat it serves.
 * - **Re-homed:** its column, by key then category (`pickStatusForMove`).
 * - **Cleared:** its milestone, the requirements it delivers, and every
 *   dependency on a task that stays behind. Each belongs to the old project;
 *   a link across projects would be counted by one and invisible in the
 *   other. Dependencies *between* the moved tasks survive, so a task moved
 *   with its sub-tasks keeps them. The board names all of this before it asks.
 *
 * Drafts awaiting review are not moved: they belong to their plan run.
 */

export class MoveTaskError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
    this.name = "MoveTaskError";
  }
}

export async function moveTasks(
  access: Pick<WorkspaceAccess, "workspaceId" | "userId">,
  taskIds: readonly string[],
  projectId: string,
) {
  const { workspaceId, userId } = access;
  const ids = [...new Set(taskIds)];

  // Only a project the person can see: a colleague's personal project is
  // hidden from them, and filing work into it would hide it from them too.
  const [target, tasks] = await Promise.all([
    prisma.project.findFirst({
      where: { AND: [{ id: projectId }, visibleProjectWhere(workspaceId, userId)] },
      select: { id: true, name: true },
    }),
    prisma.task.findMany({
      where: officialRecordWhere({ id: { in: ids }, workspaceId }),
      select: {
        id: true,
        projectId: true,
        milestoneId: true,
        status: { select: { key: true, category: true } },
      },
    }),
  ]);
  if (!target) throw new MoveTaskError("Project not found", 404);
  if (tasks.length !== ids.length) throw new MoveTaskError("Task not found", 404);
  const moving = tasks.filter((task) => task.projectId !== target.id);
  if (moving.length === 0) {
    throw new MoveTaskError("The task is already in this project", 400);
  }

  const statuses = await prisma.projectTaskStatus.findMany({
    where: { workspaceId, projectId: target.id },
    select: { id: true, key: true, category: true, position: true, isDefault: true },
  });
  const plans = moving.map((task) => {
    const picked = pickStatusForMove(statuses, task.status);
    if (!picked) throw new MoveTaskError("That project has no task columns", 409);
    return {
      task,
      picked,
      completedAt: completedAtOnStatusChange(
        task.status.category,
        picked.status.category,
        DONE_TASK_CATEGORY,
      ),
    };
  });
  const movingIds = moving.map((task) => task.id);

  return prisma.$transaction(async (tx) => {
    for (const { task, picked, completedAt } of plans) {
      // Conditional on the project it was read in, so two people moving the
      // same task at once cannot both clear its links.
      const { count } = await tx.task.updateMany({
        where: { id: task.id, workspaceId, projectId: task.projectId },
        data: {
          projectId: target.id,
          statusId: picked.status.id,
          milestoneId: null,
          ...(completedAt !== undefined ? { completedAt } : {}),
        },
      });
      if (count !== 1) throw new MoveTaskError("A task was just moved or deleted", 409);
    }

    const dependencies = await tx.taskDependency.deleteMany({
      where: {
        workspaceId,
        OR: [
          { taskId: { in: movingIds }, dependsOnTaskId: { notIn: movingIds } },
          { dependsOnTaskId: { in: movingIds }, taskId: { notIn: movingIds } },
        ],
      },
    });
    const requirements = await tx.requirementLink.deleteMany({
      where: { workspaceId, taskId: { in: movingIds } },
    });
    const moved = await tx.task.findMany({
      where: { id: { in: movingIds }, workspaceId },
      orderBy: { createdAt: "asc" },
      select: taskSelect,
    });

    return {
      tasks: moved,
      project: target,
      cleared: {
        milestones: moving.filter((task) => task.milestoneId !== null).length,
        dependencies: dependencies.count,
        requirements: requirements.count,
      },
      /** Blocked tasks that landed in the default column for want of a blocked one. */
      fellBack: plans.filter((plan) => plan.picked.fellBack).length,
    };
  });
}
