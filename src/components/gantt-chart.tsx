import type { GanttModel } from "@/lib/pm/gantt";
import { cn, formatDay } from "@/lib/utils";

/**
 * Gantt grid.
 *
 * Bars are positioned by percentage from src/lib/pm/gantt.ts, which means plain
 * CSS with no measurement and no charting dependency.
 *
 * Presentational only: the card, header, and the shared "not scheduled" list
 * belong to src/components/project-timeline.tsx, because the calendar view needs
 * the same chrome and two copies would drift.
 */

const ROW_LABEL_WIDTH = "12rem";

const BAR_TONE: Record<string, string> = {
  done: "bg-emerald-500",
  completed: "bg-emerald-500",
  blocked: "bg-red-500",
  at_risk: "bg-amber-500",
  in_progress: "bg-blue-500",
  on_track: "bg-blue-500",
};

function barColor(status: string, overdue: boolean): string {
  if (overdue) return "bg-red-500";
  return BAR_TONE[status] ?? "bg-slate-400";
}

export function GanttChart({ model }: { model: GanttModel | null }) {
  if (!model) {
    return (
      <div className="px-5 py-10 text-center">
        <p className="text-sm font-medium text-slate-900">Nothing scheduled yet</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
          Give a task a start and due date, or a milestone a target date, and it
          will appear on the chart.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Wide charts scroll inside this container; the page never scrolls sideways. */}
      <div className="overflow-x-auto">
        <div className="min-w-[46rem]">
          <div className="flex border-b border-slate-200 bg-slate-50/60">
            <div
              className="shrink-0 border-r border-slate-200"
              style={{ width: ROW_LABEL_WIDTH }}
            />
            <div className="relative h-8 flex-1">
              {model.ticks.map((tick) => (
                <div
                  key={tick.offsetPct}
                  className="absolute top-0 h-full border-l border-slate-200"
                  style={{ left: `${tick.offsetPct}%` }}
                >
                  <span className="absolute top-1.5 left-1 text-[11px] whitespace-nowrap text-slate-500">
                    {tick.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            {model.todayPct !== null ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 z-10 w-px bg-red-400"
                style={{
                  left: `calc(${ROW_LABEL_WIDTH} + (100% - ${ROW_LABEL_WIDTH}) * ${model.todayPct / 100})`,
                }}
              >
                <span className="absolute -top-0.5 -left-3.5 rounded-sm bg-red-500 px-1 text-[10px] font-medium text-white">
                  today
                </span>
              </div>
            ) : null}

            {model.bars.map((bar) => (
              <div
                key={`${bar.kind}-${bar.id}`}
                className="flex border-b border-slate-100 last:border-b-0 hover:bg-slate-50/70"
              >
                <div
                  className="shrink-0 truncate border-r border-slate-200 px-3 py-2 text-xs"
                  style={{ width: ROW_LABEL_WIDTH }}
                  title={bar.title}
                >
                  <span
                    className={cn(
                      "mr-1.5 inline-block size-1.5 rounded-full align-middle",
                      bar.kind === "milestone" ? "bg-purple-500" : "bg-slate-300",
                    )}
                    aria-hidden
                  />
                  <span
                    className={
                      bar.status === "done" || bar.status === "completed"
                        ? "text-slate-400 line-through"
                        : "text-slate-700"
                    }
                  >
                    {bar.title}
                  </span>
                </div>

                <div className="relative h-9 flex-1">
                  {/* Tick guides, so a bar can be read against the axis. */}
                  {model.ticks.map((tick) => (
                    <div
                      key={tick.offsetPct}
                      aria-hidden
                      className="absolute inset-y-0 border-l border-slate-100"
                      style={{ left: `${tick.offsetPct}%` }}
                    />
                  ))}

                  {bar.kind === "milestone" ? (
                    <span
                      className={cn(
                        "absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px]",
                        bar.overdue
                          ? "bg-red-500"
                          : bar.status === "completed"
                            ? "bg-emerald-500"
                            : "bg-purple-500",
                      )}
                      style={{ left: `${bar.offsetPct}%` }}
                      title={`${bar.title} — ${bar.end ? formatDay(bar.end) : ""}`}
                    />
                  ) : (
                    <span
                      className={cn(
                        "absolute top-1/2 h-4 -translate-y-1/2 rounded-full",
                        barColor(bar.status, bar.overdue),
                        bar.isPoint && "w-2 rounded-sm",
                      )}
                      style={{
                        left: `${bar.offsetPct}%`,
                        width: bar.isPoint ? undefined : `${bar.widthPct}%`,
                      }}
                      title={
                        bar.isPoint
                          ? `${bar.title} — due ${bar.end ? formatDay(bar.end) : ""}`
                          : `${bar.title} — ${bar.start ? formatDay(bar.start) : ""} to ${bar.end ? formatDay(bar.end) : ""}`
                      }
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-slate-200 px-5 py-2.5 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-full bg-blue-500" aria-hidden /> in
          progress
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-full bg-emerald-500" aria-hidden /> done
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-full bg-red-500" aria-hidden /> overdue
          or blocked
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="size-2.5 rotate-45 rounded-[2px] bg-purple-500"
            aria-hidden
          />{" "}
          milestone
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-1 rounded-sm bg-slate-400" aria-hidden /> due
          date only
        </span>
      </div>
    </>
  );
}
