import "server-only";
import type { z } from "zod";
import { getUserPreferences, type WorkspaceAccess } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { officialRecordWhere } from "@/lib/pm/rules";
import { pickStatusForCategory } from "@/lib/pm/status-pick";
import {
  createTaskCommentRecord,
  prepareTaskUpdate,
  updateTaskRecord,
} from "@/lib/pm/task-write";
import type { checkInSchema } from "@/lib/schemas";
import { DEFAULT_TIME_ZONE, localToday } from "@/lib/time";

export type CheckInInput = z.infer<typeof checkInSchema>;

export const DEFAULT_SNOOZE_DAYS = 3;

export class CheckInError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409,
  ) {
    super(message);
    this.name = "CheckInError";
  }
}

/**
 * One click from Today that says where a task stands.
 *
 * - done / blocked move the task to the first column of that category, through
 *   the same task-write path as the board, so completion timestamps follow the
 *   usual rule.
 * - progress ("still working") moves a blocked task back to an open column;
 *   on an open task it only records `checkedInAt`, which is enough to take it
 *   off the needs-an-update list.
 * - snooze hides the reminder for this person only, without touching the task —
 *   writing to the task would make it look worked on.
 *
 * A note becomes a comment by the person, in the same transaction as the
 * status change, so the two cannot come apart.
 *
 * The result carries `previousStatusId` when the task moved, which is what the
 * Undo on a one-click "done" restores.
 */
export async function checkIn(
  access: WorkspaceAccess,
  taskId: string,
  input: CheckInInput,
  now: Date = new Date(),
) {
  const task = await prisma.task.findFirst({
    where: officialRecordWhere({ id: taskId, workspaceId: access.workspaceId }),
    select: { id: true, projectId: true, status: { select: { id: true, category: true } } },
  });
  if (!task) throw new CheckInError("Task not found", 404);

  if (input.action === "snooze") {
    const preferences = await getUserPreferences(access.userId);
    const today = localToday(preferences?.timeZone ?? DEFAULT_TIME_ZONE, now);
    const until = new Date(today.getTime() + (input.days ?? DEFAULT_SNOOZE_DAYS) * 86_400_000);
    await prisma.taskSnooze.upsert({
      where: { userId_taskId: { userId: access.userId, taskId: task.id } },
      create: { workspaceId: access.workspaceId, userId: access.userId, taskId: task.id, until },
      update: { until },
    });
    return { taskId: task.id, until, previousStatusId: null };
  }

  const target =
    input.action === "done"
      ? "done"
      : input.action === "blocked"
        ? "blocked"
        : task.status.category === "blocked"
          ? "open"
          : null;

  let statusId: string | undefined;
  if (target && target !== task.status.category) {
    const statuses = await prisma.projectTaskStatus.findMany({
      where: { workspaceId: access.workspaceId, projectId: task.projectId },
      select: { id: true, key: true, category: true, position: true },
    });
    const picked = pickStatusForCategory(statuses, target);
    if (!picked) throw new CheckInError(`This project has no column for ${target} work`, 409);
    statusId = picked.id;
  }

  const prepared = statusId
    ? await prepareTaskUpdate(access.workspaceId, task.id, { statusId })
    : null;
  if (prepared && !prepared.ok) throw new CheckInError(prepared.error, 404);

  await prisma.$transaction(async (tx) => {
    if (prepared?.ok) await updateTaskRecord(tx, prepared.value, access.userId);
    await tx.task.update({ where: { id: task.id }, data: { checkedInAt: now } });
    if (input.note) {
      await createTaskCommentRecord(tx, {
        workspaceId: access.workspaceId,
        taskId: task.id,
        authorId: access.userId,
        body: input.note,
      });
    }
    // Reporting on a task answers the reminder; an old snooze is moot.
    await tx.taskSnooze.deleteMany({ where: { userId: access.userId, taskId: task.id } });
  });

  // Where the task was, so a tick pressed by mistake can put it back through the
  // ordinary status update. Null when the answer did not move it.
  return { taskId: task.id, until: null, previousStatusId: statusId ? task.status.id : null };
}
