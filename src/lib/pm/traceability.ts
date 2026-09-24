/**
 * Requirement → delivery traceability.
 *
 * Pure, so the matrix view, its summary counts, and the CSV export derive a
 * requirement's delivery state from one definition.
 *
 * Coverage (does a task exist?) and delivery (is that work finished?) are
 * different questions. `uncoveredRequirementWhere` answers the first for the
 * server counts; this answers the second from the links a page already loaded,
 * which are official records only (see `officialLinksSelect`).
 *
 * States key off `TaskStatusCategory`, never a column label — a category
 * cannot tell "Backlog" from "In progress", so no state pretends to.
 */

export type DeliveryState = "no_task" | "planned" | "partial" | "delivered";

export const DELIVERY_STATES: readonly DeliveryState[] = [
  "no_task",
  "planned",
  "partial",
  "delivered",
];

export const DELIVERY_STATE_LABEL: Record<DeliveryState, string> = {
  no_task: "No task",
  planned: "Planned",
  partial: "Partly done",
  delivered: "Delivered",
};

export interface TracedLink {
  targetType: "task" | "milestone" | "risk";
  task: { status: { category: string } } | null;
}

/**
 * - `no_task`: nothing delivers it.
 * - `planned`: linked tasks exist and none is done.
 * - `partial`: some, but not all, linked tasks are done.
 * - `delivered`: every linked task is done. One unfinished task is enough to
 *   withhold this, however many others are finished.
 */
export function deliveryState(links: TracedLink[]): DeliveryState {
  const categories = links
    .filter((link) => link.targetType === "task" && link.task)
    .map((link) => link.task!.status.category);
  if (categories.length === 0) return "no_task";
  const done = categories.filter((category) => category === "done").length;
  if (done === categories.length) return "delivered";
  return done === 0 ? "planned" : "partial";
}

export function countDeliveryStates(
  rows: Array<{ links: TracedLink[] }>,
): Record<DeliveryState, number> {
  const counts: Record<DeliveryState, number> = {
    no_task: 0,
    planned: 0,
    partial: 0,
    delivered: 0,
  };
  for (const row of rows) counts[deliveryState(row.links)] += 1;
  return counts;
}
