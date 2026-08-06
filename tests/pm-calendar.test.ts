import { describe, expect, it } from "vitest";
import {
  addUtcMonths,
  buildCalendarMonth,
  initialCalendarMonth,
  startOfUtcMonth,
  type CalendarInput,
} from "@/lib/pm/calendar";

/**
 * Calendar grid geometry.
 *
 * Pure, so the cell arithmetic is pinned without a browser. The cases that
 * matter are the ones a naive implementation gets wrong: a month that starts on
 * a Sunday needing six leading cells rather than none, a ragged final week, a
 * deadline drifting into the neighbouring month under a non-UTC offset, and
 * December rolling into January.
 */

const NOW = new Date("2026-08-04T12:00:00.000Z");
const AUGUST = new Date(Date.UTC(2026, 7, 1));

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function item(date: Date | null, extra: Partial<CalendarInput> = {}): CalendarInput {
  return {
    id: date ? date.toISOString() : "undated",
    kind: "task",
    title: "task",
    status: "todo",
    open: true,
    overdue: false,
    date,
    ...extra,
  };
}

describe("buildCalendarMonth", () => {
  it("builds whole weeks so the grid is never ragged", () => {
    for (let month = 0; month < 12; month += 1) {
      const grid = buildCalendarMonth([], new Date(Date.UTC(2026, month, 1)), NOW);

      for (const week of grid.weeks) {
        expect(week).toHaveLength(7);
      }
      expect(grid.weeks.length).toBeGreaterThanOrEqual(4);
      expect(grid.weeks.length).toBeLessThanOrEqual(6);
    }
  });

  it("starts every week on Monday", () => {
    const grid = buildCalendarMonth([], AUGUST, NOW);

    for (const week of grid.weeks) {
      expect(week[0].date.getUTCDay()).toBe(1);
      expect(week[6].date.getUTCDay()).toBe(0);
    }
  });

  it("pads a Sunday-starting month with a full leading week", () => {
    // 1 November 2026 is a Sunday, so a Monday-first grid needs six lead cells.
    const grid = buildCalendarMonth([], utc(2026, 11, 1), NOW);
    const lead = grid.weeks[0].filter((cell) => !cell.inMonth);

    expect(lead).toHaveLength(6);
    expect(grid.weeks[0][6].dayOfMonth).toBe(1);
  });

  it("needs no leading cells when the month already starts on a Monday", () => {
    // 1 June 2026 is a Monday.
    const grid = buildCalendarMonth([], utc(2026, 6, 1), NOW);

    expect(grid.weeks[0][0].dayOfMonth).toBe(1);
    expect(grid.weeks[0][0].inMonth).toBe(true);
  });

  it("marks borrowed days from the neighbouring months as out of month", () => {
    const grid = buildCalendarMonth([], AUGUST, NOW);
    const cells = grid.weeks.flat();
    const inMonth = cells.filter((cell) => cell.inMonth);

    expect(inMonth).toHaveLength(31);
    expect(inMonth[0].dayOfMonth).toBe(1);
    expect(inMonth.at(-1)!.dayOfMonth).toBe(31);
  });

  it("covers every day of a leap February exactly once", () => {
    const grid = buildCalendarMonth([], utc(2028, 2, 1), NOW);
    const days = grid.weeks
      .flat()
      .filter((cell) => cell.inMonth)
      .map((cell) => cell.dayOfMonth);

    expect(days).toEqual(Array.from({ length: 29 }, (_, index) => index + 1));
  });

  it("files a deadline on its UTC day, not the viewer's", () => {
    // Stored at UTC midnight — a local-time grid would file this on 31 July for
    // anyone west of UTC, and disagree with isOverdue.
    const grid = buildCalendarMonth([item(utc(2026, 8, 1))], AUGUST, NOW);
    const cell = grid.weeks.flat().find((day) => day.items.length > 0)!;

    expect(cell.dayOfMonth).toBe(1);
    expect(cell.inMonth).toBe(true);
  });

  it("groups several items landing on the same day into one cell", () => {
    const grid = buildCalendarMonth(
      [item(utc(2026, 8, 12)), item(utc(2026, 8, 12), { id: "second" })],
      AUGUST,
      NOW,
    );
    const filled = grid.weeks.flat().filter((cell) => cell.items.length > 0);

    expect(filled).toHaveLength(1);
    expect(filled[0].items).toHaveLength(2);
    expect(grid.inMonthCount).toBe(2);
  });

  it("omits undated items, because a cell is a date", () => {
    const grid = buildCalendarMonth([item(null)], AUGUST, NOW);

    expect(grid.inMonthCount).toBe(0);
    expect(grid.weeks.flat().every((cell) => cell.items.length === 0)).toBe(true);
  });

  it("counts only items inside the month, not the borrowed edge days", () => {
    const grid = buildCalendarMonth(
      [item(utc(2026, 7, 30)), item(utc(2026, 8, 5)), item(utc(2026, 9, 2))],
      AUGUST,
      NOW,
    );

    expect(grid.inMonthCount).toBe(1);
  });

  it("marks exactly one cell as today when today is on the grid", () => {
    const grid = buildCalendarMonth([], AUGUST, NOW);
    const today = grid.weeks.flat().filter((cell) => cell.isToday);

    expect(today).toHaveLength(1);
    expect(today[0].dayOfMonth).toBe(4);
  });

  it("marks no cell as today in a month that does not contain it", () => {
    const grid = buildCalendarMonth([], utc(2027, 3, 1), NOW);

    expect(grid.weeks.flat().some((cell) => cell.isToday)).toBe(false);
  });

  it("marks Saturday and Sunday as the weekend", () => {
    const grid = buildCalendarMonth([], AUGUST, NOW);

    for (const week of grid.weeks) {
      expect(week.slice(0, 5).every((cell) => !cell.isWeekend)).toBe(true);
      expect(week.slice(5).every((cell) => cell.isWeekend)).toBe(true);
    }
  });
});

describe("addUtcMonths", () => {
  it("rolls forward over a year boundary", () => {
    expect(addUtcMonths(utc(2026, 12, 1), 1).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });

  it("rolls backward over a year boundary", () => {
    expect(addUtcMonths(utc(2026, 1, 1), -1).toISOString()).toBe(
      "2025-12-01T00:00:00.000Z",
    );
  });

  it("normalises to the first of the month whatever day it was given", () => {
    expect(addUtcMonths(utc(2026, 8, 31), 1).toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
  });
});

describe("initialCalendarMonth", () => {
  it("opens on this month when it has work in it", () => {
    const month = initialCalendarMonth([item(utc(2026, 8, 20))], NOW);

    expect(month).toEqual(startOfUtcMonth(NOW));
  });

  it("opens on this month when there is no dated work at all", () => {
    expect(initialCalendarMonth([], NOW)).toEqual(startOfUtcMonth(NOW));
    expect(initialCalendarMonth([item(null)], NOW)).toEqual(startOfUtcMonth(NOW));
  });

  it("jumps to the nearest month rather than opening on an empty grid", () => {
    const month = initialCalendarMonth(
      [item(utc(2026, 11, 4)), item(utc(2027, 5, 1))],
      NOW,
    );

    expect(month).toEqual(utc(2026, 11, 1));
  });

  it("jumps backward when all the work is in the past", () => {
    const month = initialCalendarMonth([item(utc(2026, 5, 12))], NOW);

    expect(month).toEqual(utc(2026, 5, 1));
  });

  it("prefers upcoming work over equally distant finished work", () => {
    const month = initialCalendarMonth(
      [item(utc(2026, 7, 6)), item(utc(2026, 9, 2))],
      NOW,
    );

    // Both are 29 days from 4 August; the future one is the actionable one.
    expect(month).toEqual(utc(2026, 9, 1));
  });
});
