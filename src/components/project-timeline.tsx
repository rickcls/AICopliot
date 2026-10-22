"use client";

import { useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  GanttChartSquare,
} from "lucide-react";
import { GanttChart } from "@/components/gantt-chart";
import { useDateLocale, useT } from "@/components/i18n-provider";
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
  { id: "gantt", icon: GanttChartSquare },
  { id: "calendar", icon: CalendarDays },
] as const;

export function ProjectTimeline({
  rows,
  nowIso,
}: {
  rows: TimelineRow[];
  nowIso: string;
}) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const t = useT();
  const dateLocale = useDateLocale();

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

  const gantt = useMemo(() => buildGantt(items, now, dateLocale), [items, now, dateLocale]);
  const calendar = useMemo(
    () => buildCalendarMonth(calendarItems, month, now, dateLocale),
    [calendarItems, month, now, dateLocale],
  );

  const undated = items.filter(
    (item) => item.start === null && item.end === null,
  );
  const onThisMonth = isSameUtcMonth(month, now);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-sand-200 px-5 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-sand-900">
            {t("timeline.schedule")}
          </h2>
          <p className="mt-0.5 text-xs text-sand-500">
            {view === "calendar"
              ? t("timeline.dueInMonth", { count: calendar.inMonthCount, month: calendar.label })
              : gantt
                ? t("timeline.range", {
                    start: formatDay(gantt.start, dateLocale),
                    end: formatDay(gantt.end, dateLocale),
                    count: gantt.bars.length,
                  })
                : t("timeline.nothingScheduled")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {view === "calendar" ? (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label={t("timeline.previousMonth")}
                onClick={() => setMonth((current) => addUtcMonths(current, -1))}
              >
                <ChevronLeft className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label={t("timeline.nextMonth")}
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
                {t("timeline.today")}
              </Button>
            </div>
          ) : null}

          <div
            role="group"
            aria-label={t("timeline.viewLabel")}
            className="inline-flex rounded-lg border border-sand-200 bg-sand-50 p-0.5"
          >
            {VIEWS.map(({ id, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={view === id}
                onClick={() => setView(id)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
                  view === id
                    ? "bg-white text-sand-900 shadow-sm"
                    : "text-sand-500 hover:text-sand-900",
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                {t(`timeline.${id}`)}
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
        <div className="border-t border-sand-200 px-5 py-3">
          <p className="text-xs font-medium text-sand-600">
            {t("timeline.notScheduled", { count: undated.length })}
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {undated.map((item) => (
              <li
                key={`${item.kind}-${item.id}`}
                className="rounded-full bg-sand-100 px-2 py-0.5 text-xs text-sand-600"
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
