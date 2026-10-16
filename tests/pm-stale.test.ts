import { describe, expect, it } from "vitest";
import { daysSinceActivity, isStale, STALE_DAYS } from "@/lib/pm/rules";
import { rankTasks } from "@/lib/pm/today";

const today = new Date("2026-10-16T00:00:00Z");
const at = (iso: string) => new Date(iso);

function record(updated: string, extra: { comment?: string; snooze?: string; open?: boolean } = {}) {
  return {
    open: extra.open ?? true,
    updatedAt: at(updated),
    lastCommentAt: extra.comment ? at(extra.comment) : null,
    snoozedUntil: extra.snooze ? at(`${extra.snooze}T00:00:00Z`) : null,
  };
}

describe("isStale", () => {
  it("asks about work untouched for STALE_DAYS days", () => {
    expect(STALE_DAYS).toBe(5);
    expect(isStale(record("2026-10-10T09:00:00Z"), today)).toBe(true);
    expect(isStale(record("2026-10-11T09:00:00Z"), today)).toBe(false);
  });

  it("counts a comment by anyone as activity", () => {
    expect(isStale(record("2026-10-01T00:00:00Z", { comment: "2026-10-15T08:00:00Z" }), today)).toBe(false);
  });

  it("stays quiet through the snooze's last day, and asks again the day after", () => {
    const snoozed = record("2026-10-01T00:00:00Z", { snooze: "2026-10-16" });
    expect(isStale(snoozed, today)).toBe(false);
    expect(isStale(snoozed, at("2026-10-17T00:00:00Z"))).toBe(true);
  });

  it("never asks about finished work", () => {
    expect(isStale(record("2026-01-01T00:00:00Z", { open: false }), today)).toBe(false);
  });

  it("counts whole days since the last activity", () => {
    expect(daysSinceActivity(record("2026-10-09T09:00:00Z", { comment: "2026-10-08T00:00:00Z" }), today)).toBe(7);
  });
});

describe("rankTasks", () => {
  const task = (
    id: string,
    due: string | null,
    priority: "low" | "medium" | "high" | "urgent" = "medium",
    category: "open" | "blocked" | "done" = "open",
    stale = false,
  ) => ({
    id,
    dueDate: due ? at(`${due}T00:00:00Z`) : null,
    priority,
    status: { category },
    stale,
  });

  it("puts what cannot wait first, then priority, and sinks blocked work", () => {
    const ranked = rankTasks(
      [
        task("later-low", "2026-11-30", "low"),
        task("urgent-undated", null, "urgent"),
        task("overdue", "2026-10-12"),
        task("today", "2026-10-16"),
        task("blocked-today", "2026-10-16", "medium", "blocked"),
        task("in-two-days", "2026-10-18"),
        task("done", "2026-10-01", "urgent", "done"),
      ],
      today,
    );
    // Blocked-and-due-today ties with open-and-due-in-two-days; the earlier
    // deadline wins the tie, because a blocker due today needs chasing today.
    expect(ranked.map((item) => item.id)).toEqual([
      "overdue",
      "today",
      "blocked-today",
      "in-two-days",
      "urgent-undated",
      "later-low",
    ]);
  });

  it("lifts quiet work slightly", () => {
    const ranked = rankTasks([task("fresh", null), task("quiet", null, "medium", "open", true)], today);
    expect(ranked[0].id).toBe("quiet");
  });
});
