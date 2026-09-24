import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Badge, Card, ProgressBar, SectionHeader, StatCard } from "@/components/ui";
import { percentOf } from "@/lib/pm/progress";
import {
  getDashboardSummary,
  getProjectHealthRows,
  type DashboardTaskRef,
  type ProjectHealthRow,
} from "@/lib/pm/summary";
import { formatDay } from "@/lib/utils";

/**
 * Workspace-wide project health.
 *
 * Server component: every count comes from a workspace-scoped query built in
 * src/lib/pm/rules.ts, so a card and the list beneath it cannot disagree.
 */

function WorkList({
  id,
  title,
  tasks,
  dateTone,
  empty,
}: {
  id: string;
  title: string;
  tasks: DashboardTaskRef[];
  dateTone?: "danger";
  empty: string;
}) {
  return (
    <Card id={id} className="scroll-mt-6 p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {tasks.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">{empty}</p>
      ) : (
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
      )}
    </Card>
  );
}

/**
 * One line per project, exceptions badged rather than fields: a project with
 * nothing late, blocked, or uncovered shows only its name and progress, so the
 * ones that need attention are the ones with colour.
 */
function ProjectHealthList({ rows }: { rows: ProjectHealthRow[] }) {
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-slate-100">
        {rows.map((row) => {
          const total = row.openTasks + row.doneTasks;
          const percent = percentOf(row.doneTasks, total);
          return (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3"
            >
              <Link
                href={`/projects/${row.id}`}
                className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 hover:underline"
              >
                {row.name}
              </Link>
              <div className="flex flex-wrap items-center gap-1.5">
                {row.overdueTasks > 0 ? (
                  <Link href={`/projects/${row.id}/tasks?filter=overdue`}>
                    <Badge tone="danger">{row.overdueTasks} overdue</Badge>
                  </Link>
                ) : null}
                {row.blockedTasks > 0 ? (
                  <Link href={`/projects/${row.id}/tasks?filter=blocked`}>
                    <Badge tone="warning">{row.blockedTasks} blocked</Badge>
                  </Link>
                ) : null}
                {row.uncoveredRequirements > 0 ? (
                  <Link href={`/projects/${row.id}/requirements?filter=gaps`}>
                    <Badge tone="danger">
                      {row.uncoveredRequirements} uncovered
                    </Badge>
                  </Link>
                ) : null}
                {row.pendingPlanRuns > 0 ? (
                  <Link href={`/projects/${row.id}/review`}>
                    <Badge tone="info">plan to review</Badge>
                  </Link>
                ) : null}
              </div>
              <div className="flex w-full items-center gap-2 sm:w-44">
                {total === 0 ? (
                  <span className="text-xs text-slate-400">No tasks yet</span>
                ) : (
                  <>
                    <ProgressBar
                      percent={percent}
                      label={`${row.name}: tasks done`}
                      className="flex-1"
                    />
                    <span className="w-16 text-right text-xs text-slate-500 tabular-nums">
                      {row.doneTasks}/{total} done
                    </span>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/**
 * The discovery inbox: one line per project, showing what is waiting on you
 * (drafts to review) and on the client (open questions). Exceptions are
 * badged; a project with nothing waiting shows only its agreed count.
 */
function DiscoveryList({ rows }: { rows: ProjectHealthRow[] }) {
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-slate-100">
        {rows.map((row) => {
          const live = row.toReview + row.askClient + row.validated + row.agreed;
          return (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3"
            >
              <Link
                href={`/projects/${row.id}`}
                className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 hover:underline"
              >
                {row.name}
              </Link>
              <div className="flex flex-wrap items-center gap-1.5">
                {row.toReview > 0 ? (
                  <Link href={`/projects/${row.id}/requirements?filter=draft`}>
                    <Badge tone="info">{row.toReview} to review</Badge>
                  </Link>
                ) : null}
                {row.askClient > 0 ? (
                  <Link
                    href={`/projects/${row.id}/requirements?filter=needs_clarification`}
                  >
                    <Badge tone="warning">{row.askClient} ask client</Badge>
                  </Link>
                ) : null}
              </div>
              <span className="w-full text-xs text-slate-500 tabular-nums sm:w-36 sm:text-right">
                {live === 0
                  ? "No requirements yet"
                  : `${row.agreed} of ${live} agreed`}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export async function DashboardSummary({ workspaceId }: { workspaceId: string }) {
  const now = new Date();
  const [summary, projects] = await Promise.all([
    getDashboardSummary(workspaceId, now),
    getProjectHealthRows(workspaceId, now),
  ]);

  const total = (key: "toReview" | "askClient" | "agreed") =>
    projects.reduce((sum, row) => sum + row[key], 0);
  const deliveryProjects = projects.filter((row) => row.deliveryEnabled);

  const allClear =
    summary.overdueTaskList.length === 0 &&
    summary.dueSoonTaskList.length === 0 &&
    summary.blockedTaskList.length === 0;

  // Discovery first, because that is the product. The delivery half only
  // renders when some project has delivery tools on — otherwise it would be
  // a wall of zeros about work this workspace does not track here.
  return (
    <section aria-label="Project summary" className="mb-8 space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Projects" value={projects.length} href="#discovery" />
        <StatCard
          label="Requirements to review"
          value={total("toReview")}
          tone="warning"
          href="#discovery"
        />
        <StatCard
          label="Questions for clients"
          value={total("askClient")}
          tone="warning"
          href="#discovery"
        />
        <StatCard
          label="Agreed requirements"
          value={total("agreed")}
          tone="success"
          href="#discovery"
        />
      </div>

      <div id="discovery" className="scroll-mt-6 space-y-3">
        <SectionHeader
          title="Discovery"
          description="What is waiting on you, and on the client. Badges open the rows they count."
        />
        <DiscoveryList rows={projects} />
      </div>

      {deliveryProjects.length > 0 ? (
        <div className="space-y-4">
          <SectionHeader
            title="Delivery"
            description={`Across ${deliveryProjects.length} project${deliveryProjects.length === 1 ? "" : "s"} with delivery tools on.`}
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Active projects"
              value={summary.activeProjects}
              href="#projects"
            />
            <StatCard
              label="Overdue tasks"
              value={summary.overdueTasks}
              href="#overdue"
              tone="danger"
            />
            <StatCard
              label="Blocked tasks"
              value={summary.blockedTasks}
              href="#blocked"
              tone="warning"
            />
            <StatCard
              label="Upcoming milestones"
              value={summary.upcomingMilestones}
              href="#milestones"
            />
          </div>

          {allClear ? (
            <Card className="flex items-center gap-3 border-emerald-200 bg-emerald-50/60 px-5 py-4">
              <CheckCircle2 className="size-5 shrink-0 text-emerald-600" aria-hidden />
              <p className="text-sm text-emerald-900">
                Nothing is overdue, blocked, or due in the next 7 days.
              </p>
            </Card>
          ) : (
            <div className="grid gap-3 lg:grid-cols-3">
              <WorkList
                id="overdue"
                title="Overdue right now"
                tasks={summary.overdueTaskList}
                dateTone="danger"
                empty="Nothing is past its due date."
              />
              <WorkList
                id="due-soon"
                title="Due in 7 days"
                tasks={summary.dueSoonTaskList}
                empty="Nothing due this week."
              />
              <WorkList
                id="blocked"
                title="Blocked"
                tasks={summary.blockedTaskList}
                empty="Nothing is blocked."
              />
            </div>
          )}

          <div id="projects" className="scroll-mt-6">
            <ProjectHealthList rows={deliveryProjects} />
          </div>

          {summary.upcomingMilestoneList.length > 0 ? (
            <Card id="milestones" className="scroll-mt-6 p-5">
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
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
