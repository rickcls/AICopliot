import { describe, expect, it } from "vitest";
import { isOverdue, overdueTaskWhere } from "@/lib/pm/rules";
import { isValidTimeZone, localDateString, localToday } from "@/lib/time";

/**
 * "Today" is the viewer's calendar day, expressed as UTC midnight of that date
 * so the existing UTC-day rules keep working unchanged.
 */
describe("localToday", () => {
  it("rolls over at local midnight in Hong Kong, not UTC midnight", () => {
    // 23:59 HKT on the 15th.
    expect(localDateString("Asia/Hong_Kong", new Date("2026-10-15T15:59:00Z"))).toBe(
      "2026-10-15",
    );
    // 00:00 HKT on the 16th, while it is still the 15th in UTC.
    expect(localToday("Asia/Hong_Kong", new Date("2026-10-15T16:00:00Z"))).toEqual(
      new Date("2026-10-16T00:00:00.000Z"),
    );
  });

  it("follows daylight saving west of UTC", () => {
    // 23:30 EDT (UTC-4) on 31 Oct is already 1 Nov in UTC.
    expect(localDateString("America/New_York", new Date("2026-11-01T03:30:00Z"))).toBe(
      "2026-10-31",
    );
    // 23:30 EST (UTC-5) after the change, likewise.
    expect(localDateString("America/New_York", new Date("2026-11-02T04:30:00Z"))).toBe(
      "2026-11-01",
    );
  });

  it("falls back to Hong Kong for an invalid zone instead of throwing", () => {
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(localDateString("Mars/Olympus", new Date("2026-10-15T16:30:00Z"))).toBe(
      "2026-10-16",
    );
  });

  it("accepts real zones", () => {
    expect(isValidTimeZone("Asia/Hong_Kong")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("rules anchored on the viewer's day", () => {
  // 07:00 HKT on 16 Oct — still 15 Oct in UTC.
  const earlyMorning = new Date("2026-10-15T23:00:00Z");
  const today = localToday("Asia/Hong_Kong", earlyMorning);
  const dueToday = new Date("2026-10-16T00:00:00Z");
  const dueYesterday = new Date("2026-10-15T00:00:00Z");

  it("does not call a task due today overdue", () => {
    expect(isOverdue({ date: dueToday, open: true }, today)).toBe(false);
  });

  it("calls yesterday's task overdue before UTC has caught up", () => {
    // With the UTC clock this was not yet overdue until 08:00 HKT.
    expect(isOverdue({ date: dueYesterday, open: true }, earlyMorning)).toBe(false);
    expect(isOverdue({ date: dueYesterday, open: true }, today)).toBe(true);
  });

  it("puts the overdue cutoff at the viewer's midnight in the query too", () => {
    expect(overdueTaskWhere("w1", today).dueDate).toEqual({
      lt: new Date("2026-10-16T00:00:00Z"),
    });
  });
});
