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

/** A requirement a task, milestone, or risk traces back to. */
export interface TracedRequirementRow {
  id: string;
  requirement: { id: string; sequence: number; title: string; status: string };
}

export type DocumentStatus = "uploaded" | "processing" | "ready" | "failed";

/** A project document offered for linking to a task. */
export interface ProjectDocumentOption {
  id: string;
  originalFilename: string;
  status: DocumentStatus;
}

export interface TaskRow {
  id: string;
  projectId: string;
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
  requirementLinks: TracedRequirementRow[];
  documents: Array<{ id: string; document: ProjectDocumentOption }>;
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

/** A project a task can be moved to: those the viewer sees, their own first. */
export interface ProjectOption {
  id: string;
  name: string;
}

export const TASK_PRIORITIES: TaskPriority[] = [
  "low",
  "medium",
  "high",
  "urgent",
];

export const STATUS_DOT: Record<TaskStatusColor, string> = {
  slate: "bg-sand-400",
  blue: "bg-blue-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  emerald: "bg-emerald-500",
  violet: "bg-violet-500",
  pink: "bg-pink-500",
  cyan: "bg-cyan-500",
};

/**
 * A list group's heading pill: tinted, with the column's dot beside it.
 *
 * It was a solid fill with white text. The dark theme keeps every 500 shade
 * where it is and turns white into the dark surface, so a solid 500 pill
 * became dark text on a mid tone; a 50/700 pair inverts cleanly instead.
 */
export const STATUS_PILL: Record<TaskStatusColor, string> = {
  slate: "bg-sand-100 text-sand-700 ring-sand-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200/70",
  amber: "bg-amber-50 text-amber-800 ring-amber-200/70",
  red: "bg-red-50 text-red-700 ring-red-200/70",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200/70",
  violet: "bg-violet-50 text-violet-700 ring-violet-200/70",
  pink: "bg-pink-50 text-pink-700 ring-pink-200/70",
  cyan: "bg-cyan-50 text-cyan-700 ring-cyan-200/70",
};

/**
 * Flag icon colour: the one place a task's priority is drawn. `low` is nearly
 * invisible on purpose — the flag exists to find the urgent rows.
 */
export const PRIORITY_FLAG = {
  low: "text-sand-300",
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
/**
 * `todayIso` is the viewer's day anchor from the server (UTC midnight of their
 * local date). Reading the browser clock here would put "today" in UTC, so a
 * task due today in Hong Kong read as overdue until 08:00 — and the board
 * disagreed with the server's overdue count.
 */
export function isTaskOverdue(task: TaskRow, todayIso: string): boolean {
  if (!task.dueDate || task.status.category === "done") return false;
  return task.dueDate.slice(0, 10) < todayIso.slice(0, 10);
}

/** `<input type="date">` needs YYYY-MM-DD, not a full ISO timestamp. */
export function toDateInput(value: string | null): string {
  return value ? value.slice(0, 10) : "";
}
