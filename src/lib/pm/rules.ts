import type {
  GenerationStatus,
  MilestoneStatus,
  RecordSource,
  RequirementStatus,
  TaskStatusCategory,
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
 *
 * Task *columns* are per-project (`ProjectTaskStatus`). These helpers key off
 * `TaskStatusCategory` only — never a label or key — so a custom "QA" column
 * with category `open` stays overdue-eligible the same way `todo` does.
 */

/** Categories representing work that is not finished. */
export const OPEN_TASK_CATEGORIES = [
  "open",
  "blocked",
] as const satisfies readonly TaskStatusCategory[];

/** The single category that means the work is finished. */
export const DONE_TASK_CATEGORY = "done" as const satisfies TaskStatusCategory;

/** The category that means the work is stuck. */
export const BLOCKED_TASK_CATEGORY =
  "blocked" as const satisfies TaskStatusCategory;

/** Milestone statuses representing work that is not finished. */
export const OPEN_MILESTONE_STATUSES = [
  "not_started",
  "on_track",
  "at_risk",
  "blocked",
] as const satisfies readonly MilestoneStatus[];

/** Requirement statuses that are still being worked out with the client. */
export const OPEN_REQUIREMENT_STATUSES = [
  "draft",
  "needs_clarification",
  "validated",
] as const satisfies readonly RequirementStatus[];

/** The single status that means "agreed scope". */
export const BASELINED_REQUIREMENT_STATUS = "approved" as const;

export const DUE_SOON_DAYS = 7;

const MS_PER_DAY = 86_400_000;

/**
 * The only records allowed into operational project views and calculations.
 *
 * Keeping both halves of the invariant explicit prevents a malformed manual
 * row with a draft status (or an AI row without approval) from becoming
 * official merely because one column happens to match.
 */
export const OFFICIAL_RECORD_FILTER = {
  OR: [
    { source: "manual" as const, generationStatus: "not_applicable" as const },
    { source: "ai_suggested" as const, generationStatus: "approved" as const },
  ],
} as const;

/** Add the canonical official-record predicate to a scoped record filter. */
export function officialRecordWhere<T extends object>(where: T) {
  return {
    ...where,
    // Return a mutable array so the result is assignable to Prisma's generated
    // WhereInput types even though the exported constant is readonly.
    OR: OFFICIAL_RECORD_FILTER.OR.map((clause) => ({ ...clause })),
  };
}

/**
 * Display key for a requirement, e.g. `REQ-007`.
 *
 * The stored column is an integer so it sorts correctly past 999 and the format
 * stays changeable; only this function knows what a requirement is called.
 */
export function formatRequirementCode(sequence: number): string {
  return `REQ-${String(sequence).padStart(3, "0")}`;
}

/**
 * Review state implied by a requirement's lifecycle transition.
 *
 * Requirements carry two axes: `generationStatus` records whether a human
 * accepted the *record*, `status` records whether its *content* is agreed. For
 * an AI proposal the first follows from the second — moving a draft anywhere
 * other than back to `draft` or out to `rejected` means a person kept it.
 * Manual records were never proposals, so their axis stays `not_applicable`.
 *
 * `undefined` means "do not write this column", matching completedAtOnStatusChange.
 */
export function requirementGenerationStatusFor(
  source: RecordSource,
  nextStatus: RequirementStatus | undefined,
): GenerationStatus | undefined {
  if (source !== "ai_suggested" || nextStatus === undefined) return undefined;
  if (nextStatus === "draft") return "draft";
  if (nextStatus === "rejected") return "rejected";
  return "approved";
}

/** Initial completion time for a newly-created terminal record. */
export function completedAtOnCreate<T extends string>(
  status: T,
  terminalStatus: T,
  now: Date = new Date(),
): Date | null {
  return status === terminalStatus ? now : null;
}

/**
 * Completion timestamp mutation for a status PATCH.
 *
 * `undefined` means "do not write this column", which preserves the existing
 * value for unrelated edits and idempotent status updates.
 */
export function completedAtOnStatusChange<T extends string>(
  currentStatus: T,
  nextStatus: T | undefined,
  terminalStatus: T,
  now: Date = new Date(),
): Date | null | undefined {
  if (nextStatus === undefined || nextStatus === currentStatus) return undefined;
  return nextStatus === terminalStatus ? now : null;
}

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

export function isTaskOpen(category: TaskStatusCategory): boolean {
  return (OPEN_TASK_CATEGORIES as readonly TaskStatusCategory[]).includes(
    category,
  );
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

export interface DependencyEdge {
  taskId: string;
  dependsOnTaskId: string;
}

/**
 * Whether adding `candidate` would make the directed dependency graph cyclic.
 * Following `task -> prerequisite` edges, a new A -> B is unsafe exactly when
 * B can already reach A.
 */
export function wouldCreateDependencyCycle(
  edges: readonly DependencyEdge[],
  candidate: DependencyEdge,
): boolean {
  if (candidate.taskId === candidate.dependsOnTaskId) return true;

  const nextByTask = new Map<string, string[]>();
  for (const edge of edges) {
    const next = nextByTask.get(edge.taskId) ?? [];
    next.push(edge.dependsOnTaskId);
    nextByTask.set(edge.taskId, next);
  }

  const pending = [candidate.dependsOnTaskId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const taskId = pending.pop()!;
    if (taskId === candidate.taskId) return true;
    if (visited.has(taskId)) continue;
    visited.add(taskId);
    pending.push(...(nextByTask.get(taskId) ?? []));
  }
  return false;
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
  return officialRecordWhere({
    workspaceId,
    ...(projectId ? { projectId } : {}),
    status: { category: { in: [...OPEN_TASK_CATEGORIES] } },
    dueDate: { lt: startOfUtcDay(now) },
  });
}

/**
 * Open work due today through the next `DUE_SOON_DAYS`, inclusive.
 *
 * The lower bound is the UTC day, matching `overdueTaskWhere`, so a task due
 * today is due-soon and not overdue. The upper bound is `now` plus that many
 * UTC days, which still includes a date-only due date (UTC midnight) on the
 * last day.
 */
export function dueSoonTaskWhere(
  workspaceId: string,
  now: Date,
  projectId?: string,
) {
  const dueSoonCutoff = new Date(now);
  dueSoonCutoff.setUTCDate(dueSoonCutoff.getUTCDate() + DUE_SOON_DAYS);
  return officialRecordWhere({
    workspaceId,
    ...(projectId ? { projectId } : {}),
    status: { category: { in: [...OPEN_TASK_CATEGORIES] } },
    dueDate: { gte: startOfUtcDay(now), lte: dueSoonCutoff },
  });
}

export function blockedTaskWhere(workspaceId: string, projectId?: string) {
  return officialRecordWhere({
    workspaceId,
    ...(projectId ? { projectId } : {}),
    status: { category: BLOCKED_TASK_CATEGORY },
  });
}

export function upcomingMilestoneWhere(
  workspaceId: string,
  now: Date,
  projectId?: string,
) {
  return officialRecordWhere({
    workspaceId,
    ...(projectId ? { projectId } : {}),
    status: { in: [...OPEN_MILESTONE_STATUSES] },
    targetDate: { gte: startOfUtcDay(now) },
  });
}

/**
 * Requirements that are agreed scope.
 *
 * Both axes are required: `officialRecordWhere` excludes unreviewed and rejected
 * AI proposals, and `status` excludes anything the client has not agreed —
 * including a manually typed requirement, which is official the moment it is
 * saved but is still only a draft.
 */
export function baselinedRequirementWhere(
  workspaceId: string,
  projectId?: string,
) {
  return officialRecordWhere({
    workspaceId,
    ...(projectId ? { projectId } : {}),
    status: BASELINED_REQUIREMENT_STATUS,
  });
}

/**
 * Agreed scope with no delivery behind it — the coverage gap the register
 * exists to surface. The linked task must itself be official, so a rejected AI
 * task proposal cannot make a requirement look covered.
 */
export function uncoveredRequirementWhere(
  workspaceId: string,
  projectId?: string,
) {
  return {
    ...baselinedRequirementWhere(workspaceId, projectId),
    links: {
      none: {
        targetType: "task" as const,
        task: officialRecordWhere({}),
      },
    },
  };
}

/**
 * Agreed scope with nothing to test it against.
 *
 * Checks `null` only rather than also `""`, because `optionalText` in
 * src/lib/schemas.ts normalises empty strings to null on every write path.
 * Adding an `OR` here would silently be discarded — `officialRecordWhere`
 * overwrites any `OR` in its argument, so a predicate that needs its own must
 * be composed as `{ AND: [officialRecordWhere({...}), { OR: [...] }] }`.
 */
export function unvalidatedRequirementWhere(
  workspaceId: string,
  projectId?: string,
) {
  return {
    ...baselinedRequirementWhere(workspaceId, projectId),
    acceptanceCriteria: null,
  };
}

/**
 * Register entries still waiting on a decision: drafts nobody has reviewed and
 * questions that have to go back to the client. Not the official predicate —
 * a draft requirement is the working state this queue exists to show
 * (invariant 14).
 */
export const UNDECIDED_REQUIREMENT_STATUSES = [
  "draft",
  "needs_clarification",
] as const satisfies readonly RequirementStatus[];

export function undecidedRequirementWhere(
  workspaceId: string,
  projectId?: string,
) {
  return {
    workspaceId,
    ...(projectId ? { projectId } : {}),
    status: { in: [...UNDECIDED_REQUIREMENT_STATUSES] },
  };
}

/** Generated delivery plans that exist only as proposals on the Review tab. */
export function pendingPlanRunWhere(workspaceId: string, projectId?: string) {
  return {
    workspaceId,
    ...(projectId ? { projectId } : {}),
    type: { in: ["project_plan" as const, "tasks" as const] },
    status: "draft" as const,
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
      {
        tasks: {
          some: officialRecordWhere({
            status: { category: { in: [...OPEN_TASK_CATEGORIES] } },
          }),
        },
      },
      {
        milestones: {
          some: officialRecordWhere({
            status: { in: [...OPEN_MILESTONE_STATUSES] },
          }),
        },
      },
    ],
  };
}
