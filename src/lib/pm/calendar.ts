import { daysBetween, startOfUtcDay } from "./rules";

/**
 * Month-grid geometry for the Timeline calendar.
 *
 * Pure and I/O-free like ./gantt.ts, so the arithmetic that decides which cell a
 * deadline lands in is unit-testable rather than buried in JSX.
 *
 * Every date is built with `Date.UTC` and read with `getUTC*`. Due dates are
 * stored at UTC midnight, so a grid built from local getters would file a
 * 1 August deadline in the July cell for anyone west of UTC — and disagree with
 * `isOverdue`, which is UTC-pinned.
 */

/**
 * Monday. A project week reads Monday-first, which also keeps the weekend
 * together at the end of the row instead of splitting it across both edges.
 */
const WEEK_STARTS_ON = 1;

const DAYS_PER_WEEK = 7;
const MS_PER_DAY = 86_400_000;

export interface CalendarInput {
  id: string;
  kind: "task" | "milestone";
  title: string;
  status: string;
  open: boolean;
  overdue: boolean;
  /** The day this item lands on: a task's due date or a milestone's target. */
  date: Date | null;
}

export interface CalendarCell {
  /** UTC midnight of this day. */
  date: Date;
  dayOfMonth: number;
  /** False for the leading and trailing days borrowed from adjacent months. */
  inMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
  items: CalendarInput[];
}

export interface CalendarMonth {
  /** UTC midnight of the first of the displayed month. */
  month: Date;
  label: string;
  /** Whole weeks of exactly seven cells, so the grid is never ragged. */
  weeks: CalendarCell[][];
  /** Items landing inside this month, so a header can count without a scan. */
  inMonthCount: number;
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/** UTC midnight of the first of the given instant's month. */
export function startOfUtcMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

/** Month arithmetic that rolls over the year, since `Date.UTC` normalises. */
export function addUtcMonths(month: Date, delta: number): Date {
  return new Date(
    Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + delta, 1),
  );
}

export function isSameUtcMonth(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth()
  );
}

/** Day 0 of the following month is the last day of this one. */
function daysInUtcMonth(month: Date): number {
  return new Date(
    Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0),
  ).getUTCDate();
}

export function formatUtcMonth(month: Date): string {
  return month.toLocaleDateString(undefined, {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
}

/**
 * Builds the grid for one month.
 *
 * Undated items are simply absent: a calendar cell *is* a date, so there is
 * nowhere honest to draw one. The caller lists them separately, the same way
 * `buildGantt` returns its `undated` set rather than dropping it.
 */
export function buildCalendarMonth(
  items: readonly CalendarInput[],
  month: Date,
  now: Date,
): CalendarMonth {
  const first = startOfUtcMonth(month);
  const today = startOfUtcDay(now).getTime();

  const byDay = new Map<number, CalendarInput[]>();
  for (const item of items) {
    if (item.date === null) continue;
    const key = startOfUtcDay(item.date).getTime();
    const bucket = byDay.get(key);
    if (bucket) bucket.push(item);
    else byDay.set(key, [item]);
  }

  // Whole weeks only, so the grid stays rectangular: back up to the week start
  // before the 1st, then round the cell count up to a multiple of seven.
  const leading = (first.getUTCDay() - WEEK_STARTS_ON + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  const cellCount =
    Math.ceil((leading + daysInUtcMonth(first)) / DAYS_PER_WEEK) * DAYS_PER_WEEK;
  const gridStart = addUtcDays(first, -leading);

  const weeks: CalendarCell[][] = [];
  let inMonthCount = 0;

  for (let index = 0; index < cellCount; index += 1) {
    const date = addUtcDays(gridStart, index);
    const weekday = date.getUTCDay();
    const inMonth = isSameUtcMonth(date, first);
    const dayItems = byDay.get(date.getTime()) ?? [];

    if (inMonth) inMonthCount += dayItems.length;

    const cell: CalendarCell = {
      date,
      dayOfMonth: date.getUTCDate(),
      inMonth,
      isToday: date.getTime() === today,
      isWeekend: weekday === 0 || weekday === 6,
      items: dayItems,
    };

    if (index % DAYS_PER_WEEK === 0) weeks.push([cell]);
    else weeks[weeks.length - 1].push(cell);
  }

  return { month: first, label: formatUtcMonth(first), weeks, inMonthCount };
}

/**
 * The month to open on.
 *
 * This month whenever it has anything in it, because that is where "how are we
 * doing" is answered. A project entirely in the future would otherwise open on
 * an empty grid and look like it had no work at all, so fall back to the month
 * of the nearest dated item — preferring the future on a tie, since upcoming
 * work is more actionable than finished work.
 */
export function initialCalendarMonth(
  items: readonly CalendarInput[],
  now: Date,
): Date {
  const thisMonth = startOfUtcMonth(now);
  const dated = items.filter((item) => item.date !== null);

  if (dated.length === 0) return thisMonth;
  if (dated.some((item) => isSameUtcMonth(item.date!, thisMonth))) {
    return thisMonth;
  }

  const nearest = dated.reduce((best, item) => {
    const offset = daysBetween(now, item.date!);
    const bestOffset = daysBetween(now, best.date!);
    if (Math.abs(offset) !== Math.abs(bestOffset)) {
      return Math.abs(offset) < Math.abs(bestOffset) ? item : best;
    }
    return offset > bestOffset ? item : best;
  });

  return startOfUtcMonth(nearest.date!);
}
