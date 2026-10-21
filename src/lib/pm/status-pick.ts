import type { TaskStatusCategory } from "@/generated/prisma/enums";

/**
 * The project column a "done / blocked / still going" report moves a task to.
 *
 * Columns are per project and may be renamed or added, so this goes by
 * category and board order, never by label. "Still going" prefers the seeded
 * In progress column over the first open one (usually Backlog), because
 * reporting progress means the work has started. A project with no blocked
 * column returns null; the caller says so rather than inventing one.
 */
export function pickStatusForCategory<
  T extends { id: string; key: string; category: TaskStatusCategory; position: number },
>(statuses: readonly T[], category: TaskStatusCategory): T | null {
  const ordered = [...statuses]
    .filter((status) => status.category === category)
    .sort((a, b) => a.position - b.position);
  if (category === "open") {
    return ordered.find((status) => status.key === "in_progress") ?? ordered[0] ?? null;
  }
  return ordered[0] ?? null;
}

/**
 * The column a task lands in when it moves to another project.
 *
 * The same key first (Backlog to Backlog), then the first column of the same
 * category in board order — not "In progress", because moving a task is not
 * a report that work started. A blocked task moving to a project that keeps
 * no blocked column goes to that project's default column, and `fellBack`
 * says so, so the person is told rather than finding it there.
 */
export function pickStatusForMove<
  T extends {
    id: string;
    key: string;
    category: TaskStatusCategory;
    position: number;
    isDefault: boolean;
  },
>(
  statuses: readonly T[],
  current: { key: string; category: TaskStatusCategory },
): { status: T; fellBack: boolean } | null {
  const ordered = [...statuses].sort((a, b) => a.position - b.position);
  const same =
    ordered.find((status) => status.key === current.key && status.category === current.category) ??
    ordered.find((status) => status.category === current.category);
  if (same) return { status: same, fellBack: false };
  const fallback = ordered.find((status) => status.isDefault) ?? ordered[0];
  return fallback ? { status: fallback, fellBack: true } : null;
}
