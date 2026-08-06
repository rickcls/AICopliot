import { describe, expect, it } from "vitest";
import { countProgress, type ProgressInput } from "@/lib/pm/progress";

/**
 * Progress rollup.
 *
 * The cases worth pinning are the ones a naive `filter().length` gets wrong: a
 * percentage rounding up to 100 while work is still open, the open buckets
 * failing to partition, and a blocked-and-late task being counted once when it
 * describes two different problems.
 */

const NOW = new Date("2026-08-04T12:00:00.000Z");

function day(offset: number): Date {
  const date = new Date("2026-08-04T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + offset);
  return date;
}

function item(extra: Partial<ProgressInput> = {}): ProgressInput {
  return { status: "todo", open: true, date: day(30), ...extra };
}

const done = (extra: Partial<ProgressInput> = {}) =>
  item({ status: "done", open: false, ...extra });

describe("countProgress", () => {
  it("returns zeroes for an empty project rather than dividing by zero", () => {
    const counts = countProgress([], NOW);

    expect(counts.total).toBe(0);
    expect(counts.percentComplete).toBe(0);
  });

  it("splits total into done and open", () => {
    const counts = countProgress([item(), item(), done()], NOW);

    expect(counts.total).toBe(3);
    expect(counts.done).toBe(1);
    expect(counts.open).toBe(2);
  });

  it("partitions every open record across overdue, due soon, and undated", () => {
    const counts = countProgress(
      [
        item({ date: day(-3) }),
        item({ date: day(2) }),
        item({ date: day(90) }),
        item({ date: null }),
        done({ date: day(-3) }),
      ],
      NOW,
    );

    expect(counts.overdue).toBe(1);
    expect(counts.dueSoon).toBe(1);
    expect(counts.undated).toBe(1);
    // The three buckets plus the far-future record account for every open row.
    expect(counts.overdue + counts.dueSoon + counts.undated).toBeLessThanOrEqual(
      counts.open,
    );
  });

  it("never counts a finished record as overdue, however late it was", () => {
    const counts = countProgress([done({ date: day(-100) })], NOW);

    expect(counts.overdue).toBe(0);
    expect(counts.percentComplete).toBe(100);
  });

  it("treats a record due today as due soon, not overdue", () => {
    const counts = countProgress([item({ date: day(0) })], NOW);

    expect(counts.overdue).toBe(0);
    expect(counts.dueSoon).toBe(1);
  });

  it("counts at risk as an independent axis, so a late blocked task shows in both", () => {
    const counts = countProgress([item({ status: "blocked", date: day(-1) })], NOW);

    expect(counts.overdue).toBe(1);
    expect(counts.atRisk).toBe(1);
  });

  it("counts a milestone flagged at_risk alongside blocked ones", () => {
    const counts = countProgress(
      [item({ status: "at_risk" }), item({ status: "blocked" }), item()],
      NOW,
    );

    expect(counts.atRisk).toBe(2);
  });

  it("ignores the status of finished records when flagging risk", () => {
    const counts = countProgress([done({ status: "blocked" })], NOW);

    expect(counts.atRisk).toBe(0);
  });

  it("reports a whole percentage", () => {
    const counts = countProgress([done(), done(), done(), item()], NOW);

    expect(counts.percentComplete).toBe(75);
  });

  it("never rounds up to 100 while work is still open", () => {
    const items = [...Array(199).fill(null).map(() => done()), item()];
    const counts = countProgress(items, NOW);

    expect(counts.percentComplete).toBe(99);
  });

  it("never rounds down to 0 once something is finished", () => {
    const items = [done(), ...Array(199).fill(null).map(() => item())];
    const counts = countProgress(items, NOW);

    expect(counts.percentComplete).toBe(1);
  });

  it("reports 0 rather than 1 when genuinely nothing is finished", () => {
    const counts = countProgress([item(), item()], NOW);

    expect(counts.percentComplete).toBe(0);
  });
});
