import { daysBetween, startOfUtcDay } from "./rules";

/**
 * Gantt geometry.
 *
 * Pure and I/O-free like ./rules.ts, so the arithmetic that decides where a bar
 * sits is unit-testable rather than buried in JSX. Everything is expressed as a
 * percentage of the chart width, which lets the component be plain CSS with no
 * measurement, no layout effects, and no charting dependency.
 *
 * All dates are treated at UTC-day granularity, matching how due dates are
 * stored and how "overdue" is decided.
 */

export interface GanttInput {
  id: string;
  kind: "task" | "milestone";
  title: string;
  /** Null for milestones, and for tasks that only have a due date. */
  start: Date | null;
  /** A task's due date or a milestone's target date. */
  end: Date | null;
  status: string;
  open: boolean;
  overdue: boolean;
}

export interface GanttBar extends GanttInput {
  /** Left edge, as a percentage of the chart width. */
  offsetPct: number;
  /** Width, as a percentage. Zero-length items get MIN_BAR_PCT so they stay visible. */
  widthPct: number;
  /** A single date rather than a span — rendered as a marker, not a bar. */
  isPoint: boolean;
}

export interface GanttTick {
  label: string;
  offsetPct: number;
}

export interface GanttModel {
  start: Date;
  end: Date;
  totalDays: number;
  bars: GanttBar[];
  ticks: GanttTick[];
  /** Position of today, or null when today falls outside the charted range. */
  todayPct: number | null;
  /** Items with no dates at all — listed separately rather than dropped. */
  undated: GanttInput[];
}

/** Days of padding on each side so bars never touch the chart edge. */
const PADDING_DAYS = 2;

/** A same-day item would otherwise be invisible. */
const MIN_BAR_PCT = 1.5;

const MS_PER_DAY = 86_400_000;

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/**
 * Chooses a tick spacing that keeps the axis readable: roughly 6–12 labels
 * whatever the span, so a two-week project and a two-year one both work.
 */
export function chooseTickDays(totalDays: number): number {
  if (totalDays <= 14) return 2;
  if (totalDays <= 35) return 7;
  if (totalDays <= 120) return 14;
  if (totalDays <= 400) return 30;
  return 90;
}

function labelFor(date: Date, tickDays: number): string {
  return date.toLocaleDateString(undefined, {
    timeZone: "UTC",
    month: "short",
    day: tickDays >= 30 ? undefined : "numeric",
    year: tickDays >= 90 ? "numeric" : undefined,
  });
}

/**
 * Builds the chart model. Returns null when nothing has a date, so the caller
 * can render an empty state instead of an axis with no content.
 */
export function buildGantt(
  items: readonly GanttInput[],
  now: Date = new Date(),
): GanttModel | null {
  const dated = items.filter((item) => item.start !== null || item.end !== null);
  const undated = items.filter((item) => item.start === null && item.end === null);

  if (dated.length === 0) return null;

  const stamps: number[] = [];
  for (const item of dated) {
    if (item.start) stamps.push(startOfUtcDay(item.start).getTime());
    if (item.end) stamps.push(startOfUtcDay(item.end).getTime());
  }

  // Include today so the marker is always inside the range — a chart whose
  // "now" line sits off-screen is disorienting.
  stamps.push(startOfUtcDay(now).getTime());

  const start = addDays(new Date(Math.min(...stamps)), -PADDING_DAYS);
  const end = addDays(new Date(Math.max(...stamps)), PADDING_DAYS);
  const totalDays = Math.max(daysBetween(start, end), 1);

  const pctFor = (date: Date) => (daysBetween(start, date) / totalDays) * 100;

  const bars: GanttBar[] = dated.map((item) => {
    // A task with only a due date has a deadline but no duration; show where it
    // lands rather than inventing a span.
    const from = item.start ?? item.end!;
    const to = item.end ?? item.start!;
    const isPoint = item.kind === "milestone" || !item.start || !item.end;

    const offsetPct = pctFor(from);
    // +1 so a bar covers its final day rather than stopping at its start.
    const rawWidth = isPoint ? 0 : ((daysBetween(from, to) + 1) / totalDays) * 100;

    return {
      ...item,
      offsetPct: Math.max(0, Math.min(offsetPct, 100)),
      widthPct: Math.max(rawWidth, MIN_BAR_PCT),
      isPoint,
    };
  });

  const tickDays = chooseTickDays(totalDays);
  const ticks: GanttTick[] = [];
  for (let day = 0; day <= totalDays; day += tickDays) {
    const date = addDays(start, day);
    ticks.push({ label: labelFor(date, tickDays), offsetPct: (day / totalDays) * 100 });
  }

  const todayOffset = daysBetween(start, now);
  const todayPct =
    todayOffset >= 0 && todayOffset <= totalDays
      ? (todayOffset / totalDays) * 100
      : null;

  return { start, end, totalDays, bars, ticks, todayPct, undated };
}
