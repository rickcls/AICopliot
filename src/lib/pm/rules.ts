import type {
  MilestoneStatus,
  TaskStatus,
} from "@/generated/prisma/enums";

/**
 * Project-management rules.
 *
 * Pure and I/O-free, like chunking and citation validation, so "overdue",
 * "blocked", and "due this week" have exactly one definition that a test can
 * pin — rather than a `where` clause retyped slightly differently on each page.
 *
 * Dates are compared at UTC day granularity. `<input type="date">` submits
 * `YYYY-MM-DD`, which parses as UTC midnight, so a task due today must not read
 * as overdue merely because the viewer is west of UTC.
 */

/** Statuses representing work that is not finished. */
export const OPEN_TASK_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "blocked",
] as const satisfies readonly TaskStatus[];

/** Milestone statuses representing work that is not finished. */
export const OPEN_MILESTONE_STATUSES = [
  "not_started",
  "on_track",
  "at_risk",
  "blocked",
] as const satisfies readonly MilestoneStatus[];

export const DUE_SOON_DAYS = 7;

const MS_PER_DAY = 86_400_000;

/** Midnight UTC of the given instant's calendar day. */
export function startOfUtcDay(value: Date): Date {
  return new Date(
    Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate(),
    ),
  );
}

/** Whole days from `from` to `to`, positive when `to` is later. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round(
    (startOfUtcDay(to).getTime() - startOfUtcDay(from).getTime()) / MS_PER_DAY,
  );
}

export interface DatedRecord {
  date: Date | null;
  open: boolean;
}

/** Undated or finished work is never overdue; a record due today is not yet overdue. */
export function isOverdue(record: DatedRecord, now: Date): boolean {
  if (!record.open || record.date === null) return false;
  return daysBetween(now, record.date) < 0;
}

/** Open, not overdue, and falling within the next `days` days inclusive. */
export function isDueWithinDays(
  record: DatedRecord,
  now: Date,
  days: number = DUE_SOON_DAYS,
): boolean {
  if (!record.open || record.date === null) return false;
  const offset = daysBetween(now, record.date);
  return offset >= 0 && offset <= days;
}

export function isTaskOpen(status: TaskStatus): boolean {
  return (OPEN_TASK_STATUSES as readonly TaskStatus[]).includes(status);
}

export function isMilestoneOpen(status: MilestoneStatus): boolean {
  return (OPEN_MILESTONE_STATUSES as readonly MilestoneStatus[]).includes(
    status,
  );
}

// --- Timeline --------------------------------------------------------------

export interface TimelineItem {
  id: string;
  kind: "task" | "milestone";
  title: string;
  date: Date | null;
  open: boolean;
  status: string;
}

export interface TimelineBuckets<T> {
  overdue: T[];
  dueSoon: T[];
  upcoming: T[];
  undated: T[];
}

/**
 * Splits dated work into the four timeline sections. Every item lands in
 * exactly one bucket: closed items with a date sort into `upcoming` (history)
 * rather than `overdue`, and anything without a date is listed separately so it
 * is visible rather than silently dropped.
 */
export function bucketTimeline<T extends DatedRecord>(
  items: readonly T[],
  now: Date,
  days: number = DUE_SOON_DAYS,
): TimelineBuckets<T> {
  const buckets: TimelineBuckets<T> = {
    overdue: [],
    dueSoon: [],
    upcoming: [],
    undated: [],
  };

  for (const item of items) {
    if (item.date === null) buckets.undated.push(item);
    else if (isOverdue(item, now)) buckets.overdue.push(item);
    else if (isDueWithinDays(item, now, days)) buckets.dueSoon.push(item);
    else buckets.upcoming.push(item);
  }

  const byDate = (a: T, b: T) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0);
  buckets.overdue.sort(byDate);
  buckets.dueSoon.sort(byDate);
  buckets.upcoming.sort(byDate);

  return buckets;
}

// --- Dependencies ----------------------------------------------------------

export interface DependencyCandidate {
  taskId: string;
  dependsOnTaskId: string;
  /** Both tasks resolved inside the same project of the caller's workspace. */
  sameProject: boolean;
  /** Dependencies the task already has. */
  existingDependsOnIds: readonly string[];
}

export type DependencyCheck =
  | { ok: true }
  | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * The three ways a dependency can be invalid. A self-reference is additionally
 * blocked by a CHECK constraint, so a mistake here degrades to a database error
 * rather than corrupt data.
 */
export function validateDependency(
  candidate: DependencyCandidate,
): DependencyCheck {
  if (candidate.taskId === candidate.dependsOnTaskId) {
    return { ok: false, status: 400, error: "A task cannot depend on itself" };
  }
  if (!candidate.sameProject) {
    return {
      ok: false,
      status: 404,
      error: "That task is not in this project",
    };
  }
  if (candidate.existingDependsOnIds.includes(candidate.dependsOnTaskId)) {
    return {
      ok: false,
      status: 409,
      error: "That dependency already exists",
    };
  }
  return { ok: true };
}

// --- Scoped query filters --------------------------------------------------
//
// Built here rather than inline so every caller inherits the same definition
// *and* the same workspace constraint. Each builder takes workspaceId first
// because no query may omit it.

export function overdueTaskWhere(
  workspaceId: string,
  now: Date,
  projectId?: string,
) {
  return {
    workspaceId,
    ...(projectId ? { projectId } : {}),
    status: { in: [...OPEN_TASK_STATUSES] },
    dueDate: { lt: startOfUtcDay(now) },
  };
}

export function blockedTaskWhere(workspaceId: string, projectId?: string) {
  return {
    workspaceId,
    ...(projectId ? { projectId } : {}),
    status: "blocked" as const,
  };
}

export function upcomingMilestoneWhere(
  workspaceId: string,
  now: Date,
  projectId?: string,
) {
  return {
    workspaceId,
    ...(projectId ? { projectId } : {}),
    status: { in: [...OPEN_MILESTONE_STATUSES] },
    targetDate: { gte: startOfUtcDay(now) },
  };
}

/**
 * A project counts as active while it still has unfinished work. A project with
 * no tasks and no milestones has nothing in flight, so it is not counted.
 */
export function activeProjectWhere(workspaceId: string) {
  return {
    workspaceId,
    OR: [
      { tasks: { some: { status: { in: [...OPEN_TASK_STATUSES] } } } },
      { milestones: { some: { status: { in: [...OPEN_MILESTONE_STATUSES] } } } },
    ],
  };
}
