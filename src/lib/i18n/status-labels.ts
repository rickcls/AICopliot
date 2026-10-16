import { DEFAULT_TASK_STATUSES } from "@/lib/pm/task-statuses";
import type { Translate } from "@/lib/i18n/translate";

const SEEDED_LABEL = new Map(
  DEFAULT_TASK_STATUSES.map((status) => [status.key, status.label]),
);

/**
 * A task column's label as shown to the viewer.
 *
 * Column labels are data: every project is seeded with English labels, and a
 * person may rename a column. Only a column that still carries its seeded key
 * *and* its seeded English label is translated — a renamed column is the
 * team's own word and is shown exactly as typed.
 */
export function displayStatusLabel(
  status: { key: string; label: string },
  t: Translate,
): string {
  const seeded = SEEDED_LABEL.get(status.key);
  if (seeded === undefined || seeded !== status.label) return status.label;
  return t(`taskStatus.${status.key}` as Parameters<Translate>[0]);
}
