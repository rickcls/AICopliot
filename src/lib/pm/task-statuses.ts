/**
 * Per-project task board columns.
 *
 * Status *values* are rows on ProjectTaskStatus. Category (open | blocked |
 * done) is the only thing overdue, completion timestamps, blockers, and reports
 * key off — so a renamed "In progress" or a custom "QA" column keeps working
 * without rewriting those rules.
 */

import type { TaskStatusCategory } from "@/generated/prisma/enums";

export type TaskStatusColor =
  | "slate"
  | "blue"
  | "amber"
  | "red"
  | "emerald"
  | "violet"
  | "pink"
  | "cyan";

export const TASK_STATUS_COLORS: TaskStatusColor[] = [
  "slate",
  "blue",
  "amber",
  "red",
  "emerald",
  "violet",
  "pink",
  "cyan",
];

export interface DefaultTaskStatus {
  key: string;
  label: string;
  category: TaskStatusCategory;
  position: number;
  color: TaskStatusColor;
  isDefault: boolean;
}

/** Seeded on every new project so boards open with a familiar workflow. */
export const DEFAULT_TASK_STATUSES: readonly DefaultTaskStatus[] = [
  {
    key: "backlog",
    label: "Backlog",
    category: "open",
    position: 0,
    color: "slate",
    isDefault: true,
  },
  {
    key: "todo",
    label: "To do",
    category: "open",
    position: 1,
    color: "blue",
    isDefault: false,
  },
  {
    key: "in_progress",
    label: "In progress",
    category: "open",
    position: 2,
    color: "amber",
    isDefault: false,
  },
  {
    key: "blocked",
    label: "Blocked",
    category: "blocked",
    position: 3,
    color: "red",
    isDefault: false,
  },
  {
    key: "done",
    label: "Done",
    category: "done",
    position: 4,
    color: "emerald",
    isDefault: false,
  },
] as const;

/** Prisma createMany payload for a freshly created project. */
export function defaultTaskStatusRows(workspaceId: string, projectId: string) {
  const now = new Date();
  return DEFAULT_TASK_STATUSES.map((status) => ({
    workspaceId,
    projectId,
    key: status.key,
    label: status.label,
    category: status.category,
    position: status.position,
    color: status.color,
    isDefault: status.isDefault,
    createdAt: now,
    updatedAt: now,
  }));
}

/**
 * Turns a label into a project-unique key. Collisions get a numeric suffix —
 * the caller must pass the keys already taken in the project.
 */
export function slugifyStatusKey(label: string, taken: ReadonlySet<string>): string {
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "status";

  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

export function categoryTone(category: TaskStatusCategory): TaskStatusColor {
  if (category === "blocked") return "red";
  if (category === "done") return "emerald";
  return "blue";
}
