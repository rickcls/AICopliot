/**
 * Shared board types.
 *
 * Kept out of task-board.tsx so the card, the dependency editor, and the detail
 * panel can import them without a cycle back through the board.
 */

export type TaskStatus = "backlog" | "todo" | "in_progress" | "blocked" | "done";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

export interface TaskCitationRow {
  id: string;
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
  dependsOnTask: { title: string; status: TaskStatus };
}

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  assignee: { id: string; name: string | null; email: string } | null;
  estimatedHours: number | null;
  /** ISO strings — Dates are serialised before crossing to the client. */
  startDate: string | null;
  dueDate: string | null;
  source: "manual" | "ai_suggested";
  generationStatus: "not_applicable" | "draft" | "approved" | "rejected";
  dependencies: TaskDependencyRow[];
  citations: TaskCitationRow[];
}

export interface MemberOption {
  id: string;
  name: string;
}

export const BOARD_COLUMNS: Array<{ status: TaskStatus; label: string }> = [
  { status: "backlog", label: "Backlog" },
  { status: "todo", label: "To do" },
  { status: "in_progress", label: "In progress" },
  { status: "blocked", label: "Blocked" },
  { status: "done", label: "Done" },
];

export const TASK_PRIORITIES: TaskPriority[] = [
  "low",
  "medium",
  "high",
  "urgent",
];

/**
 * Compares the date portion only, matching the UTC-day rule the server uses in
 * src/lib/pm/rules.ts — a task due today must never read as overdue.
 */
export function isTaskOverdue(task: TaskRow): boolean {
  if (!task.dueDate || task.status === "done") return false;
  return task.dueDate.slice(0, 10) < new Date().toISOString().slice(0, 10);
}

/** `<input type="date">` needs YYYY-MM-DD, not a full ISO timestamp. */
export function toDateInput(value: string | null): string {
  return value ? value.slice(0, 10) : "";
}
