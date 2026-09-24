import type { TaskStatusCategory } from "@/generated/prisma/enums";
import {
  formatRequirementCode,
  isDueWithinDays,
  isOverdue,
  isTaskOpen,
} from "./rules";

/**
 * Client-side list filters for the task board, the requirement register, and
 * the risk list.
 *
 * Pure, and built on the same `isOverdue`/`isDueWithinDays` as the server
 * predicates, so a card on the Overview that says "3 overdue" and the Tasks tab
 * filtered to Overdue show the same three rows. A filter only narrows what is
 * already loaded — it never widens a read beyond the official records the page
 * fetched.
 */

/**
 * Every whitespace-separated term must appear in at least one field,
 * case-insensitively. AND across terms is what makes typing a second word
 * narrow the list rather than widen it.
 */
export function matchesQuery(
  query: string,
  fields: Array<string | null | undefined>,
): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = fields
    .filter((field): field is string => Boolean(field))
    .join("\n")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

// --- Tasks -----------------------------------------------------------------

export const TASK_QUICK_FILTERS = [
  "overdue",
  "due_soon",
  "blocked",
  "mine",
  "unassigned",
] as const;

export type TaskQuickFilter = (typeof TASK_QUICK_FILTERS)[number];

export const TASK_QUICK_FILTER_LABEL: Record<TaskQuickFilter, string> = {
  overdue: "Overdue",
  due_soon: "Due in 7 days",
  blocked: "Blocked",
  mine: "Assigned to me",
  unassigned: "Unassigned",
};

/** For `?filter=` — an unknown value is ignored rather than trusted. */
export function parseTaskQuickFilter(value: unknown): TaskQuickFilter | null {
  return typeof value === "string" &&
    (TASK_QUICK_FILTERS as readonly string[]).includes(value)
    ? (value as TaskQuickFilter)
    : null;
}

/** `null` on a field means "any"; the string `"none"` means "has no value". */
export interface TaskFilter {
  query: string;
  quick: TaskQuickFilter | null;
  priority: string | null;
  milestoneId: string | null;
}

export const EMPTY_TASK_FILTER: TaskFilter = {
  query: "",
  quick: null,
  priority: null,
  milestoneId: null,
};

export function isTaskFilterActive(filter: TaskFilter): boolean {
  return (
    filter.query.trim() !== "" ||
    filter.quick !== null ||
    filter.priority !== null ||
    filter.milestoneId !== null
  );
}

export interface FilterableTask {
  title: string;
  description: string | null;
  status: { category: TaskStatusCategory };
  priority: string;
  assigneeId: string | null;
  milestoneId: string | null;
  /** ISO string, as the board holds it. */
  dueDate: string | null;
}

export function matchesTaskQuickFilter(
  task: FilterableTask,
  quick: TaskQuickFilter,
  context: { now: Date; currentUserId: string },
): boolean {
  const open = isTaskOpen(task.status.category);
  const dated = {
    date: task.dueDate ? new Date(task.dueDate) : null,
    open,
  };
  switch (quick) {
    case "overdue":
      return isOverdue(dated, context.now);
    case "due_soon":
      return isDueWithinDays(dated, context.now);
    case "blocked":
      return task.status.category === "blocked";
    case "mine":
      return task.assigneeId === context.currentUserId;
    case "unassigned":
      return open && task.assigneeId === null;
  }
}

export function taskMatches(
  task: FilterableTask,
  filter: TaskFilter,
  context: { now: Date; currentUserId: string },
): boolean {
  if (filter.quick && !matchesTaskQuickFilter(task, filter.quick, context)) {
    return false;
  }
  if (filter.priority !== null && task.priority !== filter.priority) return false;
  if (filter.milestoneId === "none" && task.milestoneId !== null) return false;
  if (
    filter.milestoneId !== null &&
    filter.milestoneId !== "none" &&
    task.milestoneId !== filter.milestoneId
  ) {
    return false;
  }
  return matchesQuery(filter.query, [task.title, task.description]);
}

// --- Requirements ----------------------------------------------------------

const REQUIREMENT_STATUSES = [
  "draft",
  "needs_clarification",
  "validated",
  "approved",
  "rejected",
] as const;

/** "all" and "gaps" are views over the register, not stored states. */
export type RegisterFilter =
  | "all"
  | "gaps"
  | (typeof REQUIREMENT_STATUSES)[number];

/** For `?filter=` on the register — an unknown value falls back to "all". */
export function parseRegisterFilter(value: unknown): RegisterFilter {
  if (value === "gaps") return "gaps";
  return typeof value === "string" &&
    (REQUIREMENT_STATUSES as readonly string[]).includes(value)
    ? (value as RegisterFilter)
    : "all";
}

export interface RequirementFilter {
  query: string;
  type: string | null;
  priority: string | null;
  confidence: string | null;
}

export const EMPTY_REQUIREMENT_FILTER: RequirementFilter = {
  query: "",
  type: null,
  priority: null,
  confidence: null,
};

export interface FilterableRequirement {
  sequence: number;
  title: string;
  description: string | null;
  acceptanceCriteria: string | null;
  stakeholder: string | null;
  type: string;
  priority: string;
  confidence: string;
}

/**
 * The code is searchable as rendered ("REQ-007"), because that is what people
 * paste from a meeting note — not the bare sequence number.
 */
export function requirementMatches(
  requirement: FilterableRequirement,
  filter: RequirementFilter,
): boolean {
  if (filter.type !== null && requirement.type !== filter.type) return false;
  if (filter.priority !== null && requirement.priority !== filter.priority) {
    return false;
  }
  if (filter.confidence !== null && requirement.confidence !== filter.confidence) {
    return false;
  }
  return matchesQuery(filter.query, [
    formatRequirementCode(requirement.sequence),
    requirement.title,
    requirement.description,
    requirement.acceptanceCriteria,
    requirement.stakeholder,
  ]);
}

// --- Risks -----------------------------------------------------------------

export type RiskLevel = "low" | "medium" | "high";

const LEVEL_SCORE: Record<RiskLevel, number> = { low: 1, medium: 2, high: 3 };

/**
 * Impact × likelihood on the existing three-point scales. Used only to *order*
 * risks; it is never rendered as a number, so it does not become a severity
 * scale of its own.
 */
export function riskExposure(risk: {
  impact: RiskLevel;
  likelihood: RiskLevel;
}): number {
  return LEVEL_SCORE[risk.impact] * LEVEL_SCORE[risk.likelihood];
}

export type RiskSort = "recent" | "exposure";

/**
 * Highest exposure first; ties broken by impact, because a certain nuisance
 * and an unlikely catastrophe score the same and the catastrophe is the one to
 * read first. A stable sort keeps the incoming order for exact ties.
 */
export function sortRisks<
  T extends { impact: RiskLevel; likelihood: RiskLevel },
>(risks: T[], sort: RiskSort): T[] {
  if (sort === "recent") return risks;
  return [...risks].sort(
    (a, b) =>
      riskExposure(b) - riskExposure(a) ||
      LEVEL_SCORE[b.impact] - LEVEL_SCORE[a.impact],
  );
}
