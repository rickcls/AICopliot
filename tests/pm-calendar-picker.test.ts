import { describe, expect, it } from "vitest";
import {
  moveCalendarFocus,
  parseIsoDay,
  shiftIsoDay,
  shiftIsoMonth,
  weekdayLabels,
} from "@/lib/pm/calendar";

describe("parseIsoDay", () => {
  it("reads a real day as UTC midnight", () => {
    expect(parseIsoDay("2026-10-23")?.toISOString()).toBe("2026-10-23T00:00:00.000Z");
  });

  it("refuses text that is not a day, and days that do not exist", () => {
    expect(parseIsoDay("")).toBeNull();
    expect(parseIsoDay("23/10/2026")).toBeNull();
    expect(parseIsoDay("2026-02-30")).toBeNull();
    expect(parseIsoDay("2026-13-01")).toBeNull();
  });
});

describe("shiftIsoDay", () => {
  it("rolls over month and year boundaries", () => {
    expect(shiftIsoDay("2026-10-31", 1)).toBe("2026-11-01");
    expect(shiftIsoDay("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftIsoDay("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("returns an unreadable value as it came", () => {
    expect(shiftIsoDay("", 1)).toBe("");
  });
});

describe("shiftIsoMonth", () => {
  it("keeps the day number", () => {
    expect(shiftIsoMonth("2026-10-23", 1)).toBe("2026-11-23");
    expect(shiftIsoMonth("2026-10-23", -10)).toBe("2025-12-23");
  });

  it("holds a day past the end of a shorter month to its last day", () => {
    expect(shiftIsoMonth("2026-01-31", 1)).toBe("2026-02-28");
    expect(shiftIsoMonth("2028-01-31", 1)).toBe("2028-02-29");
    expect(shiftIsoMonth("2026-03-31", -1)).toBe("2026-02-28");
  });
});

describe("moveCalendarFocus", () => {
  // 2026-10-21 is a Wednesday.
  it("moves by a day with left and right, by a week with up and down", () => {
    expect(moveCalendarFocus("2026-10-21", "ArrowLeft")).toBe("2026-10-20");
    expect(moveCalendarFocus("2026-10-21", "ArrowRight")).toBe("2026-10-22");
    expect(moveCalendarFocus("2026-10-21", "ArrowUp")).toBe("2026-10-14");
    expect(moveCalendarFocus("2026-10-21", "ArrowDown")).toBe("2026-10-28");
  });

  it("takes Home to Monday and End to Sunday", () => {
    expect(moveCalendarFocus("2026-10-21", "Home")).toBe("2026-10-19");
    expect(moveCalendarFocus("2026-10-21", "End")).toBe("2026-10-25");
    expect(moveCalendarFocus("2026-10-19", "Home")).toBe("2026-10-19");
    expect(moveCalendarFocus("2026-10-25", "End")).toBe("2026-10-25");
  });

  it("moves a month with page keys", () => {
    expect(moveCalendarFocus("2026-10-21", "PageDown")).toBe("2026-11-21");
    expect(moveCalendarFocus("2026-10-21", "PageUp")).toBe("2026-09-21");
  });

  it("ignores every other key", () => {
    expect(moveCalendarFocus("2026-10-21", "a")).toBeNull();
    expect(moveCalendarFocus("2026-10-21", "Enter")).toBeNull();
  });
});

describe("weekdayLabels", () => {
  it("starts on Monday and has seven names", () => {
    const labels = weekdayLabels("en-GB");
    expect(labels).toHaveLength(7);
    expect(labels[0]).toBe("Mon");
    expect(labels[6]).toBe("Sun");
  });
});
