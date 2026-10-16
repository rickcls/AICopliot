import { describe, expect, it } from "vitest";
import {
  assignedTo,
  officialRecordWhere,
  overdueTaskWhere,
} from "@/lib/pm/rules";
import { bucketMyTasks, type TodayTask } from "@/lib/pm/today";

const today = new Date("2026-10-16T00:00:00Z");

function task(
  id: string,
  due: string | null,
  {
    priority = "medium",
    category = "open",
  }: { priority?: TodayTask["priority"]; category?: TodayTask["status"]["category"] } = {},
) {
  return {
    id,
    dueDate: due ? new Date(`${due}T00:00:00Z`) : null,
    priority,
    status: { category },
  };
}

describe("bucketMyTasks", () => {
  it("puts each task in exactly one bucket, earliest rule first", () => {
    const buckets = bucketMyTasks(
      [
        task("late", "2026-10-15"),
        task("today", "2026-10-16"),
        task("blocked-today", "2026-10-16", { category: "blocked" }),
        task("blocked", null, { category: "blocked" }),
        task("blocked-late", "2026-10-01", { category: "blocked" }),
        task("week", "2026-10-23"),
        task("later", "2026-10-24"),
        task("undated", null),
        task("done", "2026-10-01", { category: "done" }),
      ],
      today,
    );

    const ids = (list: { id: string }[]) => list.map((item) => item.id).sort();
    expect(ids(buckets.overdue)).toEqual(["blocked-late", "late"]);
    expect(ids(buckets.dueToday)).toEqual(["blocked-today", "today"]);
    expect(ids(buckets.blocked)).toEqual(["blocked"]);
    expect(ids(buckets.dueSoon)).toEqual(["week"]);
    expect(ids(buckets.later)).toEqual(["later", "undated"]);
  });

  it("orders due-today work by priority", () => {
    const buckets = bucketMyTasks(
      [
        task("low", "2026-10-16", { priority: "low" }),
        task("urgent", "2026-10-16", { priority: "urgent" }),
        task("high", "2026-10-16", { priority: "high" }),
      ],
      today,
    );
    expect(buckets.dueToday.map((item) => item.id)).toEqual(["urgent", "high", "low"]);
  });

  it("orders overdue work oldest first", () => {
    const buckets = bucketMyTasks(
      [task("b", "2026-10-10"), task("a", "2026-10-01")],
      today,
    );
    expect(buckets.overdue.map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("assignedTo", () => {
  it("narrows to the person by spreading, keeping the official-record OR", () => {
    const where = assignedTo("u1", overdueTaskWhere("w1", today));
    expect(where).toMatchObject({ workspaceId: "w1", assigneeId: "u1" });
    expect("OR" in where && Array.isArray(where.OR)).toBe(true);
  });

  it("widens to unassigned work with an AND, so neither OR is overwritten", () => {
    const base = officialRecordWhere({ workspaceId: "w1" });
    const where = assignedTo("u1", base, { includeUnassigned: true });
    expect(where).toEqual({
      AND: [base, { OR: [{ assigneeId: "u1" }, { assigneeId: null }] }],
    });
  });
});
