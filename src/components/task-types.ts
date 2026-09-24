/**
 * Shared board types.
 *
 * Kept out of task-board.tsx so the card, the dependency editor, and the detail
 * panel can import them without a cycle back through the board.
 *
 * Task columns are per-project (`ProjectTaskStatus`). Category — not the label
 * or key — is what overdue, completion, and blockers key off.
 */

export type TaskStatusCategory = "open" | "blocked" | "done";

export type TaskStatusColor =
  | "slate"
  | "blue"
  | "amber"
  | "red"
  | "emerald"
  | "violet"
  | "pink"
  | "cyan";

export type TaskPriority = "low" | "medium" | "high" | "urgent";

/** One board/list column for a project. */
export interface TaskStatusOption {
  id: string;
  key: string;
  label: string;
  category: TaskStatusCategory;
  position: number;
  color: string | null;
  isDefault: boolean;
}

export interface TaskCitationRow {
  id: string;
  purpose: "proposal" | "milestone_link";
  excerpt: string | null;
  chunk: {
    id: string;
    pageNumber: number | null;
    sectionTitle: string | null;
    document: { id: string; originalFilename: string };
  };
}

export interface TaskDependencyRow {
  id: string;
  dependsOnTaskId: string;
  source: "manual" | "ai_suggested";
  generationStatus: "not_applicable" | "draft" | "approved" | "rejected";
  dependsOnTask: { title: string; status: TaskStatusOption };
  citations: Array<{
    id: string;
    excerpt: string | null;
    chunk: {
      id: string;
      pageNumber: number | null;
      sectionTitle: string | null;
      document: { id: string; originalFilename: string };
    };
  }>;
}

export interface TaskCommentRow {
  id: string;
  body: string;
  /** ISO string — Dates are serialised before crossing to the client. */
  createdAt: string;
  /** Null once the author has been removed; the comment outlives them. */
  author: { id: string; name: string | null; email: string } | null;
}

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  statusId: string;
  status: TaskStatusOption;
  priority: TaskPriority;
  assigneeId: string | null;
  assignee: { id: string; name: string | null; email: string } | null;
  estimatedHours: number | null;
  milestoneId: string | null;
  milestone: { id: string; title: string } | null;
  /** ISO strings — Dates are serialised before crossing to the client. */
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  source: "manual" | "ai_suggested";
  generationStatus: "not_applicable" | "draft" | "approved" | "rejected";
  dependencies: TaskDependencyRow[];
  citations: TaskCitationRow[];
  comments: TaskCommentRow[];
}

export interface MemberOption {
  id: string;
  name: string;
  email: string;
}

export interface MilestoneOption {
  id: string;
  title: string;
}

export const TASK_PRIORITIES: TaskPriority[] = [
  "low",
  "medium",
  "high",
  "urgent",
];

export const STATUS_DOT: Record<TaskStatusColor, string> = {
  slate: "bg-slate-400",
  blue: "bg-blue-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  emerald: "bg-emerald-500",
  violet: "bg-violet-500",
  pink: "bg-pink-500",
  cyan: "bg-cyan-500",
};

/** Solid rather than pale: a group header is a divider. */
export const STATUS_PILL: Record<TaskStatusColor, string> = {
  slate: "bg-slate-500",
  blue: "bg-blue-600",
  amber: "bg-amber-500",
  red: "bg-red-600",
  emerald: "bg-emerald-600",
  violet: "bg-violet-600",
  pink: "bg-pink-600",
  cyan: "bg-cyan-600",
};

/** Flag icon colour — same scale as the board card stripe. */
export const PRIORITY_FLAG = {
  low: "text-slate-400",
  medium: "text-blue-500",
  high: "text-amber-500",
  urgent: "text-red-500",
} as const;

export function statusColorToken(
  status: Pick<TaskStatusOption, "color" | "category">,
): TaskStatusColor {
  const raw = status.color;
  if (
    raw === "slate" ||
    raw === "blue" ||
    raw === "amber" ||
    raw === "red" ||
    raw === "emerald" ||
    raw === "violet" ||
    raw === "pink" ||
    raw === "cyan"
  ) {
    return raw;
  }
  if (status.category === "blocked") return "red";
  if (status.category === "done") return "emerald";
  return "blue";
}

/**
 * Compares the date portion only, matching the UTC-day rule the server uses in
 * src/lib/pm/rules.ts — a task due today must never read as overdue.
 */
export function isTaskOverdue(task: TaskRow): boolean {
  if (!task.dueDate || task.status.category === "done") return false;
  return task.dueDate.slice(0, 10) < new Date().toISOString().slice(0, 10);
}

/** `<input type="date">` needs YYYY-MM-DD, not a full ISO timestamp. */
export function toDateInput(value: string | null): string {
  return value ? value.slice(0, 10) : "";
}
