import type { TaskPriority, TaskStatusCategory } from "@/generated/prisma/enums";
import { daysBetween, isDueWithinDays, isOverdue, isTaskOpen } from "@/lib/pm/rules";

/**
 * The Today page's grouping, kept pure so a bucket's rows and its count come
 * from one definition.
 *
 * Every task lands in exactly one bucket, earliest rule first: overdue, due
 * today, blocked, due in the next seven days, and everything else. Blocked
 * sits below "due today" because a task due today that is blocked is first of
 * all due today — the deadline is the fact that needs attention, and the row
 * still says it is blocked.
 *
 * `today` is the viewer's day anchor (src/lib/time.ts), not an instant.
 */

export interface TodayTask {
  dueDate: Date | null;
  priority: TaskPriority;
  status: { category: TaskStatusCategory };
}

export interface TodayBuckets<T> {
  overdue: T[];
  dueToday: T[];
  blocked: T[];
  dueSoon: T[];
  later: T[];
}

const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function byDueThenPriority(a: TodayTask, b: TodayTask): number {
  const aDue = a.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
  const bDue = b.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
  if (aDue !== bDue) return aDue - bDue;
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
}

function byPriority(a: TodayTask, b: TodayTask): number {
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
}

export function bucketMyTasks<T extends TodayTask>(
  tasks: readonly T[],
  today: Date,
): TodayBuckets<T> {
  const buckets: TodayBuckets<T> = {
    overdue: [],
    dueToday: [],
    blocked: [],
    dueSoon: [],
    later: [],
  };

  for (const task of tasks) {
    if (!isTaskOpen(task.status.category)) continue;
    const record = { date: task.dueDate, open: true };

    if (isOverdue(record, today)) buckets.overdue.push(task);
    else if (task.dueDate && daysBetween(today, task.dueDate) === 0) {
      buckets.dueToday.push(task);
    } else if (task.status.category === "blocked") buckets.blocked.push(task);
    else if (isDueWithinDays(record, today)) buckets.dueSoon.push(task);
    else buckets.later.push(task);
  }

  buckets.overdue.sort(byDueThenPriority);
  buckets.dueToday.sort(byPriority);
  buckets.blocked.sort(byDueThenPriority);
  buckets.dueSoon.sort(byDueThenPriority);
  buckets.later.sort(byDueThenPriority);
  return buckets;
}
