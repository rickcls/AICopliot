import { describe, expect, it } from "vitest";
import { buildGantt, chooseTickDays, type GanttInput } from "@/lib/pm/gantt";

/**
 * Gantt geometry.
 *
 * Pure, so the arithmetic that decides where a bar sits is pinned without a
 * browser. The cases that matter are the ones a naive implementation gets
 * wrong: a one-day task collapsing to zero width, a bar stopping short of its
 * final day, and the today marker escaping the charted range.
 */

const NOW = new Date("2026-08-04T12:00:00.000Z");

function day(offset: number): Date {
  const date = new Date("2026-08-04T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + offset);
  return date;
}

function task(
  id: string,
  start: Date | null,
  end: Date | null,
  extra: Partial<GanttInput> = {},
): GanttInput {
  return {
    id,
    kind: "task",
    title: id,
    start,
    end,
    status: "todo",
    open: true,
    overdue: false,
    ...extra,
  };
}

function milestone(id: string, end: Date | null): GanttInput {
  return {
    id,
    kind: "milestone",
    title: id,
    start: null,
    end,
    status: "not_started",
    open: true,
    overdue: false,
  };
}

describe("buildGantt", () => {
  it("returns null when nothing has a date, so the caller can show an empty state", () => {
    expect(buildGantt([task("a", null, null)], NOW)).toBeNull();
    expect(buildGantt([], NOW)).toBeNull();
  });

  it("lists undated items separately rather than dropping them", () => {
    const model = buildGantt(
      [task("dated", day(0), day(5)), task("floating", null, null)],
      NOW,
    )!;

    expect(model.bars.map((bar) => bar.id)).toEqual(["dated"]);
    expect(model.undated.map((item) => item.id)).toEqual(["floating"]);
  });

  it("spans the full range of the data with padding on both sides", () => {
    const model = buildGantt([task("a", day(0), day(10))], NOW)!;

    expect(model.start.getTime()).toBeLessThan(day(0).getTime());
    expect(model.end.getTime()).toBeGreaterThan(day(10).getTime());
  });

  it("keeps today inside the range even when all work is in the past", () => {
    const model = buildGantt([task("old", day(-90), day(-60))], NOW)!;

    expect(model.todayPct).not.toBeNull();
    expect(model.todayPct!).toBeGreaterThanOrEqual(0);
    expect(model.todayPct!).toBeLessThanOrEqual(100);
  });

  it("keeps today inside the range even when all work is in the future", () => {
    const model = buildGantt([task("future", day(60), day(90))], NOW)!;

    expect(model.todayPct).not.toBeNull();
    expect(model.todayPct!).toBeLessThanOrEqual(100);
  });

  it("places an earlier task to the left of a later one", () => {
    const model = buildGantt(
      [task("late", day(20), day(25)), task("early", day(0), day(5))],
      NOW,
    )!;

    const early = model.bars.find((bar) => bar.id === "early")!;
    const late = model.bars.find((bar) => bar.id === "late")!;
    expect(early.offsetPct).toBeLessThan(late.offsetPct);
  });

  it("gives a longer task a wider bar", () => {
    const model = buildGantt(
      [task("short", day(0), day(2)), task("long", day(0), day(20))],
      NOW,
    )!;

    const short = model.bars.find((bar) => bar.id === "short")!;
    const long = model.bars.find((bar) => bar.id === "long")!;
    expect(long.widthPct).toBeGreaterThan(short.widthPct);
  });

  it("covers the final day rather than stopping at its start", () => {
    // A task spanning day 0 to day 1 occupies two days, not one.
    const model = buildGantt([task("two-day", day(0), day(1))], NOW)!;
    const bar = model.bars[0];

    const daysCovered = (bar.widthPct / 100) * model.totalDays;
    expect(daysCovered).toBeCloseTo(2, 5);
  });

  it("never collapses a same-day task to zero width", () => {
    const model = buildGantt(
      [task("same-day", day(0), day(0)), task("context", day(0), day(200))],
      NOW,
    )!;
    const bar = model.bars.find((item) => item.id === "same-day")!;

    expect(bar.widthPct).toBeGreaterThan(0);
  });

  it("treats a task with only a due date as a point, not a span", () => {
    const model = buildGantt([task("deadline-only", null, day(5))], NOW)!;

    expect(model.bars[0].isPoint).toBe(true);
  });

  it("treats a task with a start and a due date as a span", () => {
    const model = buildGantt([task("real-span", day(0), day(5))], NOW)!;

    expect(model.bars[0].isPoint).toBe(false);
  });

  it("always treats a milestone as a point", () => {
    const model = buildGantt([milestone("m", day(5))], NOW)!;

    expect(model.bars[0].isPoint).toBe(true);
  });

  it("keeps every bar within the chart bounds", () => {
    const model = buildGantt(
      [
        task("a", day(-30), day(-20)),
        task("b", day(0), day(1)),
        task("c", day(40), day(80)),
        milestone("m", day(15)),
      ],
      NOW,
    )!;

    for (const bar of model.bars) {
      expect(bar.offsetPct).toBeGreaterThanOrEqual(0);
      expect(bar.offsetPct).toBeLessThanOrEqual(100);
      expect(bar.offsetPct + bar.widthPct).toBeLessThanOrEqual(101);
    }
  });

  it("produces axis ticks inside the range", () => {
    const model = buildGantt([task("a", day(0), day(30))], NOW)!;

    expect(model.ticks.length).toBeGreaterThan(1);
    for (const tick of model.ticks) {
      expect(tick.offsetPct).toBeGreaterThanOrEqual(0);
      expect(tick.offsetPct).toBeLessThanOrEqual(100);
    }
  });

  it("carries the overdue flag through to the bar so it can be coloured", () => {
    const model = buildGantt(
      [task("late", day(-10), day(-5), { overdue: true })],
      NOW,
    )!;

    expect(model.bars[0].overdue).toBe(true);
  });
});

describe("chooseTickDays", () => {
  it("keeps the axis readable at every span", () => {
    for (const totalDays of [7, 14, 30, 60, 180, 365, 900]) {
      const tickDays = chooseTickDays(totalDays);
      const tickCount = Math.floor(totalDays / tickDays) + 1;

      expect(tickCount).toBeGreaterThanOrEqual(2);
      expect(tickCount).toBeLessThanOrEqual(16);
    }
  });

  it("widens the spacing as the span grows", () => {
    expect(chooseTickDays(10)).toBeLessThan(chooseTickDays(100));
    expect(chooseTickDays(100)).toBeLessThan(chooseTickDays(1000));
  });
});
