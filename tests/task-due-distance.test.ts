import { describe, expect, it } from "vitest";
import { daysFromToday } from "@/components/task-types";

/**
 * The due-date pill says "3 days left" or "2 days overdue". It counts whole UTC
 * days from the viewer's today anchor, the same granularity as isTaskOverdue,
 * so the pill and the red overdue state can never disagree.
 */
describe("daysFromToday", () => {
  const today = "2026-10-22T00:00:00.000Z";

  it("is zero for today, however the timestamp is written", () => {
    expect(daysFromToday("2026-10-22", today)).toBe(0);
    expect(daysFromToday("2026-10-22T00:00:00.000Z", today)).toBe(0);
  });

  it("counts forward and back in whole days", () => {
    expect(daysFromToday("2026-10-30", today)).toBe(8);
    expect(daysFromToday("2026-10-19", today)).toBe(-3);
  });

  it("crosses a month and a year end", () => {
    expect(daysFromToday("2026-11-01", today)).toBe(10);
    expect(daysFromToday("2027-01-01", "2026-12-31")).toBe(1);
  });
});
