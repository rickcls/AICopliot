import { Card } from "@/components/ui";
import { DUE_SOON_DAYS } from "@/lib/pm/rules";
import type { ProgressCounts } from "@/lib/pm/progress";
import { cn } from "@/lib/utils";

/**
 * Progress header for the Timeline.
 *
 * Server component — every number arrives already counted by
 * src/lib/pm/progress.ts, so there is nothing to hydrate.
 */

const TONE = {
  neutral: "text-slate-900",
  warning: "text-amber-700",
  danger: "text-red-700",
} as const;

/**
 * A zero is drawn grey whatever its tone. "0 overdue" in red reads as an alarm
 * at a glance, which is exactly backwards — the colour has to mean something.
 */
function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: keyof typeof TONE;
}) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 text-2xl leading-none font-semibold tabular-nums",
          value === 0 ? "text-slate-300" : TONE[tone],
        )}
      >
        {value}
      </dd>
      {hint ? <p className="mt-1 text-[11px] text-slate-400">{hint}</p> : null}
    </div>
  );
}

export function TimelineProgress({
  tasks,
  milestones,
}: {
  tasks: ProgressCounts;
  milestones: ProgressCounts;
}) {
  const undated = tasks.undated + milestones.undated;

  return (
    <Card className="p-5">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:gap-8">
        <div className="sm:w-56 sm:shrink-0">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-xs font-medium text-slate-500">Task progress</h2>
            <span className="text-2xl leading-none font-semibold text-slate-900 tabular-nums">
              {tasks.percentComplete}%
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Task completion"
            aria-valuenow={tasks.percentComplete}
            aria-valuemin={0}
            aria-valuemax={100}
            className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-slate-100"
          >
            <div
              className="h-full rounded-full bg-emerald-500"
              style={{ width: `${tasks.percentComplete}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-500 tabular-nums">
            {tasks.done} of {tasks.total} task{tasks.total === 1 ? "" : "s"} done
          </p>
        </div>

        <dl className="grid flex-1 grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
          <Stat
            label="Overdue"
            value={tasks.overdue + milestones.overdue}
            tone="danger"
            hint="past its date, still open"
          />
          <Stat
            label={`Due in ${DUE_SOON_DAYS} days`}
            value={tasks.dueSoon + milestones.dueSoon}
            tone="warning"
          />
          <Stat
            label="At risk"
            value={tasks.atRisk + milestones.atRisk}
            tone="warning"
            hint="blocked or flagged"
          />
          <Stat
            label="Milestones"
            value={milestones.done}
            hint={`of ${milestones.total} reached`}
          />
        </dl>
      </div>

      {undated > 0 ? (
        <p className="mt-5 border-t border-slate-100 pt-3 text-xs text-slate-500">
          {undated === 1
            ? "1 open item has no date, so it is not counted in any deadline above."
            : `${undated} open items have no date, so they are not counted in any deadline above.`}
        </p>
      ) : null}
    </Card>
  );
}
