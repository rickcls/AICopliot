import Link from "next/link";
import { Card } from "@/components/ui";
import {
  getDashboardSummary,
  type DashboardTaskRef,
} from "@/lib/pm/summary";
import { formatDay } from "@/lib/utils";

/**
 * Workspace-wide project health, shown above the document library.
 *
 * Server component: every count comes from a workspace-scoped query built in
 * src/lib/pm/rules.ts, so a card and the list beneath it cannot disagree.
 */

function StatCard({
  label,
  value,
  href,
  tone,
}: {
  label: string;
  value: number;
  href: string;
  tone?: "danger" | "warning";
}) {
  return (
    <Link href={href} className="block transition-opacity hover:opacity-80">
      <Card className="p-4">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <p
          className={
            value > 0 && tone === "danger"
              ? "mt-1 text-2xl font-semibold text-red-700"
              : value > 0 && tone === "warning"
                ? "mt-1 text-2xl font-semibold text-amber-700"
                : "mt-1 text-2xl font-semibold text-slate-900"
          }
        >
          {value}
        </p>
      </Card>
    </Link>
  );
}

function WorkList({
  title,
  tasks,
  dateTone,
}: {
  title: string;
  tasks: DashboardTaskRef[];
  dateTone?: "danger";
}) {
  if (tasks.length === 0) return null;

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <ul className="mt-3 space-y-2">
        {tasks.map((task) => (
          <li
            key={task.id}
            className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
          >
            <Link
              href={`/projects/${task.project.id}/tasks?task=${task.id}`}
              className="min-w-0 truncate hover:underline"
            >
              {task.title}
            </Link>
            <span className="shrink-0 text-xs text-slate-500">
              {task.project.name}
              {task.dueDate ? (
                <>
                  {" · "}
                  <span
                    className={
                      dateTone === "danger" ? "text-red-700" : undefined
                    }
                  >
                    {formatDay(task.dueDate)}
                  </span>
                </>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export async function DashboardSummary({ workspaceId }: { workspaceId: string }) {
  const summary = await getDashboardSummary(workspaceId);

  // Always rendered now that this is the dashboard's main content rather than a
  // strip above the document table: a zero is information, not noise.
  return (
    <section aria-label="Project summary" className="mb-8">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active projects"
          value={summary.activeProjects}
          href="/projects"
        />
        <StatCard
          label="Overdue tasks"
          value={summary.overdueTasks}
          href="/projects"
          tone="danger"
        />
        <StatCard
          label="Blocked tasks"
          value={summary.blockedTasks}
          href="/projects"
          tone="warning"
        />
        <StatCard
          label="Upcoming milestones"
          value={summary.upcomingMilestones}
          href="/projects"
        />
      </div>

      {summary.overdueTaskList.length > 0 ||
      summary.dueSoonTaskList.length > 0 ||
      summary.blockedTaskList.length > 0 ? (
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          <WorkList
            title="Overdue right now"
            tasks={summary.overdueTaskList}
            dateTone="danger"
          />
          <WorkList title="Due in 7 days" tasks={summary.dueSoonTaskList} />
          <WorkList title="Blocked" tasks={summary.blockedTaskList} />
        </div>
      ) : null}

      {summary.upcomingMilestoneList.length > 0 ? (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="text-sm font-semibold">Next milestones</h2>
            <ul className="mt-3 space-y-2">
              {summary.upcomingMilestoneList.map((milestone) => (
                <li
                  key={milestone.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
                >
                  <Link
                    href={`/projects/${milestone.project.id}/timeline`}
                    className="min-w-0 truncate hover:underline"
                  >
                    {milestone.title}
                  </Link>
                  <span className="shrink-0 text-xs text-slate-500">
                    {milestone.project.name} ·{" "}
                    {milestone.targetDate
                      ? formatDay(milestone.targetDate)
                      : "No date"}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}
    </section>
  );
}
