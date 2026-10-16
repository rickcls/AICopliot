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
