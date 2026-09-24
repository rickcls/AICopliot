import { describe, expect, it } from "vitest";
import {
  activeProjectWhere,
  blockedTaskWhere,
  bucketTimeline,
  completedAtOnCreate,
  completedAtOnStatusChange,
  daysBetween,
  isDueWithinDays,
  isMilestoneOpen,
  isOverdue,
  isTaskOpen,
  dueSoonTaskWhere,
  overdueTaskWhere,
  officialRecordWhere,
  startOfUtcDay,
  upcomingMilestoneWhere,
  DUE_SOON_DAYS,
  OPEN_MILESTONE_STATUSES,
  OPEN_TASK_CATEGORIES,
  type TimelineItem,
} from "@/lib/pm/rules";

/**
 * Project-management rules.
 *
 * Pure, so this runs with no database — a failure here is always a code defect.
 * The boundaries matter most: "due today" and "due in exactly 7 days" are the
 * cases a naive millisecond comparison gets wrong.
 */

const NOW = new Date("2026-08-04T12:00:00.000Z");

/** Midnight UTC, the shape `<input type="date">` produces. */
function day(offset: number): Date {
  const date = new Date("2026-08-04T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + offset);
  return date;
}

describe("day arithmetic", () => {
  it("truncates to the UTC day so a time of day never shifts the result", () => {
    expect(daysBetween(NOW, day(0))).toBe(0);
    expect(daysBetween(NOW, day(1))).toBe(1);
    expect(daysBetween(NOW, day(-1))).toBe(-1);
  });

  it("startOfUtcDay discards the time component", () => {
    expect(startOfUtcDay(NOW).toISOString()).toBe("2026-08-04T00:00:00.000Z");
  });
});

describe("overdue (dashboard and timeline)", () => {
  it("counts open work past its due date", () => {
    expect(isOverdue({ date: day(-1), open: true }, NOW)).toBe(true);
  });

  it("does not count a task due today as overdue", () => {
    expect(isOverdue({ date: day(0), open: true }, NOW)).toBe(false);
  });

  it("does not count finished work, however late", () => {
    expect(isOverdue({ date: day(-30), open: false }, NOW)).toBe(false);
  });

  it("never counts work without a due date", () => {
    expect(isOverdue({ date: null, open: true }, NOW)).toBe(false);
  });

  it("is unaffected by the time of day on either side", () => {
    const lateInDay = new Date("2026-08-04T23:59:59.000Z");
    const earlyInDay = new Date("2026-08-04T00:00:01.000Z");
    expect(isOverdue({ date: day(0), open: true }, lateInDay)).toBe(false);
    expect(isOverdue({ date: day(0), open: true }, earlyInDay)).toBe(false);
  });
});

describe("due within the next 7 days", () => {
  it("includes today", () => {
    expect(isDueWithinDays({ date: day(0), open: true }, NOW)).toBe(true);
  });

  it("includes the seventh day", () => {
    expect(isDueWithinDays({ date: day(DUE_SOON_DAYS), open: true }, NOW)).toBe(
      true,
    );
  });

  it("excludes the eighth day", () => {
    expect(
      isDueWithinDays({ date: day(DUE_SOON_DAYS + 1), open: true }, NOW),
    ).toBe(false);
  });

  it("excludes overdue work, which belongs in its own bucket", () => {
    expect(isDueWithinDays({ date: day(-1), open: true }, NOW)).toBe(false);
  });

  it("excludes finished work", () => {
    expect(isDueWithinDays({ date: day(1), open: false }, NOW)).toBe(false);
  });
});

describe("blocked (dashboard)", () => {
  it("treats only the blocked category as blocked, regardless of dates", () => {
    const where = blockedTaskWhere("ws-1");
    expect(where.status).toEqual({ category: "blocked" });
    expect(where).not.toHaveProperty("dueDate");
  });

  it("counts blocked as open work, and done as closed", () => {
    expect(isTaskOpen("blocked")).toBe(true);
    expect(isTaskOpen("open")).toBe(true);
    expect(isTaskOpen("done")).toBe(false);
  });

  it("counts a completed milestone as closed", () => {
    expect(isMilestoneOpen("at_risk")).toBe(true);
    expect(isMilestoneOpen("completed")).toBe(false);
  });

  it("a blocked task that is also overdue appears in both counts", () => {
    // The two filters are independent by design: 'blocked' says nothing about
    // dates, and 'overdue' includes every open category.
    expect(overdueTaskWhere("ws-1", NOW).status.category.in).toContain(
      "blocked",
    );
  });
});

describe("timeline bucketing", () => {
  function item(
    id: string,
    date: Date | null,
    open = true,
  ): TimelineItem {
    return { id, kind: "task", title: id, date, open, status: "todo" };
  }

  const items = [
    item("overdue", day(-3)),
    item("today", day(0)),
    item("in-a-week", day(7)),
    item("later", day(40)),
    item("undated", null),
    item("done-and-late", day(-5), false),
  ];

  const buckets = bucketTimeline(items, NOW);

  it("puts each item in exactly one bucket", () => {
    const total =
      buckets.overdue.length +
      buckets.dueSoon.length +
      buckets.upcoming.length +
      buckets.undated.length;
    expect(total).toBe(items.length);
  });

  it("separates overdue, due-soon, later, and undated", () => {
    expect(buckets.overdue.map((i) => i.id)).toEqual(["overdue"]);
    expect(buckets.dueSoon.map((i) => i.id)).toEqual(["today", "in-a-week"]);
    expect(buckets.undated.map((i) => i.id)).toEqual(["undated"]);
  });

  it("files finished-but-late work as history rather than overdue", () => {
    expect(buckets.overdue.map((i) => i.id)).not.toContain("done-and-late");
    expect(buckets.upcoming.map((i) => i.id)).toContain("done-and-late");
  });

  it("sorts each dated bucket earliest first", () => {
    const dates = buckets.dueSoon.map((i) => i.date!.getTime());
    expect(dates).toEqual([...dates].sort((a, b) => a - b));
  });

  it("returns empty buckets rather than throwing on no input", () => {
    expect(bucketTimeline([], NOW)).toEqual({
      overdue: [],
      dueSoon: [],
      upcoming: [],
      undated: [],
    });
  });
});

describe("scoped query filters", () => {
  it("every filter constrains on workspaceId", () => {
    expect(overdueTaskWhere("ws-1", NOW)).toMatchObject({ workspaceId: "ws-1" });
    expect(dueSoonTaskWhere("ws-1", NOW)).toMatchObject({ workspaceId: "ws-1" });
    expect(blockedTaskWhere("ws-1")).toMatchObject({ workspaceId: "ws-1" });
    expect(upcomingMilestoneWhere("ws-1", NOW)).toMatchObject({
      workspaceId: "ws-1",
    });
    expect(activeProjectWhere("ws-1")).toMatchObject({ workspaceId: "ws-1" });
  });

  it("includes only manual records or approved AI suggestions", () => {
    const expected = [
      { source: "manual", generationStatus: "not_applicable" },
      { source: "ai_suggested", generationStatus: "approved" },
    ];

    expect(officialRecordWhere({ workspaceId: "ws-1" }).OR).toEqual(expected);
    expect(overdueTaskWhere("ws-1", NOW).OR).toEqual(expected);
    expect(dueSoonTaskWhere("ws-1", NOW).OR).toEqual(expected);
    expect(blockedTaskWhere("ws-1").OR).toEqual(expected);
    expect(upcomingMilestoneWhere("ws-1", NOW).OR).toEqual(expected);
  });

  it("adds projectId only when a project scope is supplied", () => {
    expect(overdueTaskWhere("ws-1", NOW)).not.toHaveProperty("projectId");
    expect(dueSoonTaskWhere("ws-1", NOW)).not.toHaveProperty("projectId");
    expect(overdueTaskWhere("ws-1", NOW, "p-1")).toMatchObject({
      workspaceId: "ws-1",
      projectId: "p-1",
    });
    expect(dueSoonTaskWhere("ws-1", NOW, "p-1")).toMatchObject({
      projectId: "p-1",
    });
    expect(blockedTaskWhere("ws-1", "p-1")).toMatchObject({ projectId: "p-1" });
    expect(upcomingMilestoneWhere("ws-1", NOW, "p-1")).toMatchObject({
      projectId: "p-1",
    });
  });

  it("overdue excludes done work inside the query, not after it", () => {
    const where = overdueTaskWhere("ws-1", NOW);
    expect(where.status.category.in).not.toContain("done");
    expect(where.dueDate.lt).toEqual(startOfUtcDay(NOW));
  });

  it("due soon runs from today through seven days and excludes done work", () => {
    const where = dueSoonTaskWhere("ws-1", NOW);
    const cutoff = new Date(NOW);
    cutoff.setUTCDate(cutoff.getUTCDate() + DUE_SOON_DAYS);
    expect(where.status.category.in).not.toContain("done");
    expect(where.dueDate.gte).toEqual(startOfUtcDay(NOW));
    expect(where.dueDate.lte).toEqual(cutoff);
  });

  it("upcoming milestones exclude completed ones and past dates", () => {
    const where = upcomingMilestoneWhere("ws-1", NOW);
    expect(where.status.in).not.toContain("completed");
    expect(where.targetDate.gte).toEqual(startOfUtcDay(NOW));
  });

  it("a project counts as active only while it has unfinished work", () => {
    const where = activeProjectWhere("ws-1");
    expect(where.workspaceId).toBe("ws-1");
    expect(where.OR[0].tasks?.some.status.category.in).toEqual([
      ...OPEN_TASK_CATEGORIES,
    ]);
    expect(where.OR[0].tasks?.some.OR).toEqual([
      { source: "manual", generationStatus: "not_applicable" },
      { source: "ai_suggested", generationStatus: "approved" },
    ]);
    expect(where.OR[1].milestones?.some.status.in).toEqual([
      ...OPEN_MILESTONE_STATUSES,
    ]);
    expect(where.OR[1].milestones?.some.OR).toEqual([
      { source: "manual", generationStatus: "not_applicable" },
      { source: "ai_suggested", generationStatus: "approved" },
    ]);
    expect(OPEN_TASK_CATEGORIES).not.toContain("done");
    expect(OPEN_MILESTONE_STATUSES).not.toContain("completed");
  });

  it("a project with no work at all is not counted as active", () => {
    // Both branches use `some`, so a project with zero tasks and zero
    // milestones matches neither.
    const { OR } = activeProjectWhere("ws-1");
    expect(OR).toHaveLength(2);
    expect(JSON.stringify(OR)).toContain('"some"');
  });
});

describe("completion timestamps", () => {
  const FINISHED = new Date("2026-08-05T03:04:05.000Z");

  it("timestamps newly-created terminal records only", () => {
    expect(completedAtOnCreate("done", "done", FINISHED)).toBe(FINISHED);
    expect(completedAtOnCreate("todo", "done", FINISHED)).toBeNull();
    expect(
      completedAtOnCreate("completed", "completed", FINISHED),
    ).toBe(FINISHED);
  });

  it("sets the timestamp when work enters its terminal status", () => {
    expect(
      completedAtOnStatusChange("in_progress", "done", "done", FINISHED),
    ).toBe(FINISHED);
  });

  it("clears the timestamp when completed work reopens", () => {
    expect(
      completedAtOnStatusChange("done", "blocked", "done", FINISHED),
    ).toBeNull();
  });

  it("preserves the timestamp for unrelated and idempotent updates", () => {
    expect(
      completedAtOnStatusChange("done", undefined, "done", FINISHED),
    ).toBeUndefined();
    expect(
      completedAtOnStatusChange("done", "done", "done", FINISHED),
    ).toBeUndefined();
  });
});
