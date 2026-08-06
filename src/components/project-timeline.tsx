"use client";

import { useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  GanttChartSquare,
} from "lucide-react";
import { GanttChart } from "@/components/gantt-chart";
import { TimelineCalendar } from "@/components/timeline-calendar";
import { Button, Card } from "@/components/ui";
import {
  addUtcMonths,
  buildCalendarMonth,
  initialCalendarMonth,
  isSameUtcMonth,
  startOfUtcMonth,
  type CalendarInput,
} from "@/lib/pm/calendar";
import { buildGantt, type GanttInput } from "@/lib/pm/gantt";
import { isOverdue } from "@/lib/pm/rules";
import { cn, formatDay } from "@/lib/utils";

/**
 * Timeline shell: Gantt or month calendar over one set of records.
 *
 * A client component because the view toggle and the month cursor are state.
 * Both views derive from the same `rows`, so switching view or month never
 * refetches — the page already loads every official task and milestone.
 *
 * `nowIso` is supplied by the server rather than read from `Date.now()` here.
 * Every date comparison on this page (overdue, the today marker, today's cell)
 * would otherwise be computed from a different instant during hydration than it
 * was during the server render, and disagree across a day boundary.
 */

type TimelineView = "gantt" | "calendar";

/** Serialisable row, since these cross the server/client boundary. */
export interface TimelineRow {
  id: string;
  kind: "task" | "milestone";
  title: string;
  /** ISO. Null for milestones, and for tasks with only a due date. */
  start: string | null;
  /** ISO. A task's due date or a milestone's target date. */
  end: string | null;
  status: string;
  open: boolean;
}

const VIEWS = [
  { id: "gantt", label: "Gantt", icon: GanttChartSquare },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
] as const;

export function ProjectTimeline({
  rows,
  nowIso,
}: {
  rows: TimelineRow[];
  nowIso: string;
}) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);

  const items = useMemo<GanttInput[]>(
    () =>
      rows.map((row) => {
        const end = row.end === null ? null : new Date(row.end);
        return {
          id: row.id,
          kind: row.kind,
          title: row.title,
          start: row.start === null ? null : new Date(row.start),
          end,
          status: row.status,
          open: row.open,
          overdue: isOverdue({ date: end, open: row.open }, now),
        };
      }),
    [rows, now],
  );

  const calendarItems = useMemo<CalendarInput[]>(
    () =>
      items.map((item) => ({
        id: item.id,
        kind: item.kind,
        title: item.title,
        status: item.status,
        open: item.open,
        overdue: item.overdue,
        // A task with a start but no due date still has a day worth showing.
        date: item.end ?? item.start,
      })),
    [items],
  );

  const [view, setView] = useState<TimelineView>("gantt");
  const [month, setMonth] = useState(() =>
    initialCalendarMonth(calendarItems, now),
  );

  const gantt = useMemo(() => buildGantt(items, now), [items, now]);
  const calendar = useMemo(
    () => buildCalendarMonth(calendarItems, month, now),
    [calendarItems, month, now],
  );

  const undated = items.filter(
    (item) => item.start === null && item.end === null,
  );
  const onThisMonth = isSameUtcMonth(month, now);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-slate-200 px-5 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Schedule</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {view === "calendar"
              ? `${calendar.inMonthCount} due in ${calendar.label}`
              : gantt
                ? `${formatDay(gantt.start)} – ${formatDay(gantt.end)} · ${gantt.bars.length} item${gantt.bars.length === 1 ? "" : "s"}`
                : "Nothing scheduled"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {view === "calendar" ? (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label="Previous month"
                onClick={() => setMonth((current) => addUtcMonths(current, -1))}
              >
                <ChevronLeft className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label="Next month"
                onClick={() => setMonth((current) => addUtcMonths(current, 1))}
              >
                <ChevronRight className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={onThisMonth}
                onClick={() => setMonth(startOfUtcMonth(now))}
              >
                Today
              </Button>
            </div>
          ) : null}

          <div
            role="group"
            aria-label="Timeline view"
            className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5"
          >
            {VIEWS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={view === id}
                onClick={() => setView(id)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
                  view === id
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-900",
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === "calendar" ? (
        <TimelineCalendar month={calendar} />
      ) : (
        <GanttChart model={gantt} />
      )}

      {undated.length > 0 ? (
        <div className="border-t border-slate-200 px-5 py-3">
          <p className="text-xs font-medium text-slate-600">
            Not scheduled ({undated.length})
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {undated.map((item) => (
              <li
                key={`${item.kind}-${item.id}`}
                className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
              >
                {item.title}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
