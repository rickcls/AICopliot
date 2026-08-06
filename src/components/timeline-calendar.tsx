import type { CalendarCell, CalendarInput, CalendarMonth } from "@/lib/pm/calendar";
import { cn, formatDay } from "@/lib/utils";

/**
 * Month calendar for the Timeline.
 *
 * A *deadline* calendar: each item sits on the one day it is answerable for — a
 * task's due date, a milestone's target. Drawing a multi-day task across every
 * cell it touches would need week-by-week row packing, and would bury the dates
 * that actually need attention under bars that mostly say "still in progress".
 * The Gantt view is where duration is read.
 *
 * Presentational only; the card and header belong to project-timeline.tsx.
 */

const CHIP_TONE: Record<string, string> = {
  blocked: "bg-red-50 text-red-700",
  at_risk: "bg-amber-50 text-amber-800",
  in_progress: "bg-blue-50 text-blue-700",
  on_track: "bg-blue-50 text-blue-700",
};

/**
 * Mirrors `barColor` in gantt-chart.tsx, so an item does not change meaning when
 * the view is switched: overdue and finished dominate, then an explicit status,
 * then the purple that marks a milestone in both views.
 */
function chipTone(item: CalendarInput): string {
  if (item.overdue) return "bg-red-50 text-red-700";
  if (!item.open) return "bg-emerald-50 text-emerald-700";
  return (
    CHIP_TONE[item.status] ??
    (item.kind === "milestone"
      ? "bg-purple-50 text-purple-700"
      : "bg-slate-100 text-slate-600")
  );
}

function Chip({ item }: { item: CalendarInput }) {
  const finished = !item.open;

  return (
    <li>
      <span
        title={`${item.title} — ${item.date ? formatDay(item.date) : ""} · ${item.status.replace("_", " ")}`}
        className={cn(
          "flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] leading-tight",
          chipTone(item),
          finished && "opacity-70",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0",
            item.kind === "milestone"
              ? "rotate-45 rounded-[1px] bg-current"
              : "rounded-full bg-current",
          )}
        />
        <span className={cn("truncate", finished && "line-through")}>
          {item.title}
        </span>
      </span>
    </li>
  );
}

function Day({ cell }: { cell: CalendarCell }) {
  return (
    <td
      className={cn(
        "h-24 border-r border-b border-slate-100 p-1 align-top last:border-r-0",
        // Three distinct levels, so the week structure is readable at a glance:
        // white weekday, tinted weekend, darker filler from the next month over.
        !cell.inMonth && "bg-slate-100/70",
        cell.inMonth && cell.isWeekend && "bg-slate-50",
      )}
    >
      <div className="flex justify-end px-0.5">
        {cell.isToday ? (
          <span className="inline-flex size-5 items-center justify-center rounded-full bg-red-500 text-[11px] font-semibold text-white tabular-nums">
            {cell.dayOfMonth}
          </span>
        ) : (
          <span
            className={cn(
              "inline-flex size-5 items-center justify-center text-[11px] tabular-nums",
              cell.inMonth ? "text-slate-500" : "text-slate-300",
            )}
          >
            {cell.dayOfMonth}
          </span>
        )}
      </div>

      {cell.items.length > 0 ? (
        // Every item is rendered rather than capped with a "+3 more": the view is
        // read-only, so a hidden item would have no way of ever being seen.
        <ul className="mt-0.5 space-y-0.5">
          {cell.items.map((item) => (
            <Chip key={`${item.kind}-${item.id}`} item={item} />
          ))}
        </ul>
      ) : null}
    </td>
  );
}

export function TimelineCalendar({ month }: { month: CalendarMonth }) {
  const weekdays = month.weeks[0].map((cell) =>
    cell.date.toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short" }),
  );

  return (
    <>
      {/* Seven columns need room to be legible; the page never scrolls sideways. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] table-fixed border-collapse">
          <caption className="sr-only">
            Tasks and milestones in {month.label}, by the date they are due
          </caption>
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/60">
              {weekdays.map((label, index) => (
                <th
                  key={label}
                  scope="col"
                  className={cn(
                    "border-r border-slate-200 px-2 py-1.5 text-[11px] font-medium text-slate-500 last:border-r-0",
                    index >= 5 && "text-slate-400",
                  )}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {month.weeks.map((week) => (
              <tr key={week[0].date.toISOString()}>
                {week.map((cell) => (
                  <Day key={cell.date.toISOString()} cell={cell} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-slate-200 px-5 py-2.5 text-[11px] text-slate-500">
        <span>Placed on the due or target date.</span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-blue-500" aria-hidden /> open
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-emerald-500" aria-hidden /> done
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-red-500" aria-hidden /> overdue or
          blocked
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="size-2 rotate-45 rounded-[1px] bg-purple-500"
            aria-hidden
          />{" "}
          milestone
        </span>
      </div>
    </>
  );
}
