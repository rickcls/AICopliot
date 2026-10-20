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

export interface RankableTask extends TodayTask {
  stale?: boolean;
}

/**
 * A single ordering of open work for planning a day: what cannot wait first.
 * Deterministic, so the candidates the day planner sees — and their order —
 * are the same for the same tasks on the same day.
 *
 * Deadlines dominate (overdue, then today, then the coming week, nearer
 * first), priority adjusts within that, blocked work sinks because it cannot
 * move without someone else, and work gone quiet rises a little because it
 * needs a check-in either way.
 */
export function taskUrgencyScore(task: RankableTask, today: Date): number {
  let score = 0;
  if (task.dueDate) {
    const days = daysBetween(today, task.dueDate);
    if (days < 0) score += 100 + Math.min(-days, 30) * 2;
    else if (days === 0) score += 90;
    else if (days <= 7) score += 70 - days * 5;
  }
  score += { urgent: 40, high: 20, medium: 0, low: -10 }[task.priority];
  if (task.status.category === "blocked") score -= 30;
  if (task.stale) score += 10;
  return score;
}

export function rankTasks<T extends RankableTask>(tasks: readonly T[], today: Date): T[] {
  return tasks
    .filter((task) => isTaskOpen(task.status.category))
    .map((task) => ({ task, score: taskUrgencyScore(task, today) }))
    .sort((a, b) => b.score - a.score || byDueThenPriority(a.task, b.task))
    .map((entry) => entry.task);
}

/** How many undated tasks Today lists; the rest stay in the "later" count. */
export const UNDATED_SHOWN = 5;

/**
 * Open tasks with no due date, most important first and then most recently
 * touched — usually ones just written down from a note. Undated work never
 * reaches a dated bucket, so without this list it was only ever a number at
 * the bottom of the page, and the AI is never asked to guess a date for it.
 */
export function undatedToShow<T extends TodayTask & { updatedAt: Date }>(
  later: readonly T[],
  limit: number = UNDATED_SHOWN,
): T[] {
  return later
    .filter((task) => task.dueDate === null)
    .sort((a, b) => byPriority(a, b) || b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, limit);
}
