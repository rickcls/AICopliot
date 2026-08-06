import {
  DUE_SOON_DAYS,
  isDueWithinDays,
  isOverdue,
  type DatedRecord,
} from "./rules";

/**
 * Delivery progress rollup.
 *
 * Pure and I/O-free like ./rules.ts and ./gantt.ts. Every predicate here is
 * reused from ./rules.ts rather than retyped, because a headline count that
 * disagreed with the bar it summarises would be worse than showing no count at
 * all — the reader would have no way to tell which one was wrong.
 */

/** Statuses a person has explicitly flagged as not going to plan. */
const AT_RISK_STATUSES = ["blocked", "at_risk"];

export interface ProgressInput extends DatedRecord {
  status: string;
}

export interface ProgressCounts {
  total: number;
  /** Finished — the closed half of the same `open` flag ./rules.ts defines. */
  done: number;
  open: number;
  /** Open and past its date. */
  overdue: number;
  /** Open, not yet overdue, and landing within `dueSoonDays`. */
  dueSoon: number;
  /** Open and flagged `blocked` or `at_risk`. */
  atRisk: number;
  /** Open with no date, so invisible to every deadline count above. */
  undated: number;
  /** `done / total` as a whole percent. */
  percentComplete: number;
}

/**
 * Rounded, but never *to* an endpoint it has not reached: 199/200 reads as 99%
 * rather than a 100% that sits next to unfinished work, and 1/200 reads as 1%
 * rather than a 0% that denies the work already done. Both are the kind of
 * number a reader would treat as a lie about the state of the project.
 */
function percentOf(done: number, total: number): number {
  if (total === 0 || done === 0) return 0;
  if (done >= total) return 100;
  return Math.min(99, Math.max(1, Math.round((done / total) * 100)));
}

/**
 * Counts one family of records — tasks or milestones, never both, because a
 * percentage mixing the two answers no question anyone asks.
 *
 * `overdue`, `dueSoon`, and `undated` partition the open records, so they sum to
 * `open`. `atRisk` is a second, independent axis: a blocked task is usually also
 * counted in one of the three, and double-counting it is the point — "2 overdue,
 * 1 blocked" describes one late blocked task and one merely late one.
 */
export function countProgress(
  items: readonly ProgressInput[],
  now: Date,
  dueSoonDays: number = DUE_SOON_DAYS,
): ProgressCounts {
  const counts: ProgressCounts = {
    total: 0,
    done: 0,
    open: 0,
    overdue: 0,
    dueSoon: 0,
    atRisk: 0,
    undated: 0,
    percentComplete: 0,
  };

  for (const item of items) {
    counts.total += 1;

    if (!item.open) {
      counts.done += 1;
      continue;
    }

    counts.open += 1;
    if (item.date === null) counts.undated += 1;
    else if (isOverdue(item, now)) counts.overdue += 1;
    else if (isDueWithinDays(item, now, dueSoonDays)) counts.dueSoon += 1;

    if (AT_RISK_STATUSES.includes(item.status)) counts.atRisk += 1;
  }

  counts.percentComplete = percentOf(counts.done, counts.total);
  return counts;
}
