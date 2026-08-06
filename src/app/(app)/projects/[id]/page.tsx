import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, EmptyState } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { getScopedProject } from "@/lib/pm/project";
import { getProjectSummary } from "@/lib/pm/summary";
import { blockedTaskWhere, officialRecordWhere, overdueTaskWhere } from "@/lib/pm/rules";
import { formatDay } from "@/lib/utils";

export const dynamic = "force-dynamic";

function Stat({
  label,
  value,
  tone,
  href,
}: {
  label: string;
  value: number;
  tone?: "danger" | "warning";
  href?: string;
}) {
  const body = (
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
  );

  return href ? (
    <Link href={href} className="block transition-opacity hover:opacity-80">
      {body}
    </Link>
  ) : (
    body
  );
}

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { workspaceId } = await requireWorkspace();
  const { id } = await params;

  const project = await getScopedProject(workspaceId, id);
  if (!project) notFound();

  const now = new Date();
  const [summary, overdueTasks, nextMilestones, blockedTasks] = await Promise.all([
    getProjectSummary(workspaceId, project.id, now),
    prisma.task.findMany({
      where: overdueTaskWhere(workspaceId, now, project.id),
      orderBy: { dueDate: "asc" },
      take: 5,
      select: { id: true, title: true, dueDate: true },
    }),
    prisma.milestone.findMany({
      where: officialRecordWhere({
        workspaceId,
        projectId: project.id,
        status: { not: "completed" as const },
      }),
      orderBy: [{ targetDate: "asc" }, { createdAt: "asc" }],
      take: 5,
      select: { id: true, title: true, targetDate: true, status: true },
    }),
    prisma.task.findMany({
      where: blockedTaskWhere(workspaceId, project.id),
      orderBy: { createdAt: "asc" },
      take: 5,
      select: { id: true, title: true },
    }),
  ]);

  const nothingYet =
    summary.openTasks === 0 &&
    summary.doneTasks === 0 &&
    summary.openMilestones === 0 &&
    summary.openRisks === 0 &&
    summary.totalRequirements === 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat
          label="Approved requirements"
          value={summary.approvedRequirements}
          href={`/projects/${project.id}/requirements`}
        />
        <Stat
          label="Uncovered requirements"
          value={summary.uncoveredRequirements}
          tone="danger"
          href={`/projects/${project.id}/requirements`}
        />
        <Stat
          label="Open tasks"
          value={summary.openTasks}
          href={`/projects/${project.id}/tasks`}
        />
        <Stat
          label="Overdue"
          value={summary.overdueTasks}
          tone="danger"
          href={`/projects/${project.id}/timeline`}
        />
        <Stat
          label="Blocked"
          value={summary.blockedTasks}
          tone="warning"
          href={`/projects/${project.id}/tasks`}
        />
        <Stat
          label="Open risks"
          value={summary.openRisks}
          href={`/projects/${project.id}/risks`}
        />
      </div>

      {nothingYet ? (
        <EmptyState
          title="This project has no scope yet"
          description="Start with the requirements — extract drafts from a document or record them by hand — then create the tasks, milestones, and risks that deliver them."
          action={
            <Link
              href={`/projects/${project.id}/requirements`}
              className="inline-flex h-10 items-center rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700"
            >
              Open Requirements
            </Link>
          }
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Overdue tasks</h2>
          {overdueTasks.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">
              Nothing is past its due date.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {overdueTasks.map((task) => (
                <li key={task.id} className="flex justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">{task.title}</span>
                  <span className="shrink-0 text-xs text-red-700">
                    {task.dueDate ? formatDay(task.dueDate) : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold">Upcoming milestones</h2>
          {nextMilestones.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">
              No milestones recorded yet.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {nextMilestones.map((milestone) => (
                <li
                  key={milestone.id}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="min-w-0 truncate">{milestone.title}</span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {milestone.targetDate
                      ? formatDay(milestone.targetDate)
                      : "No date"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold">Blocked tasks</h2>
          {blockedTasks.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Nothing is blocked.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {blockedTasks.map((task) => (
                <li key={task.id} className="truncate text-sm">
                  {task.title}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold">Knowledge</h2>
          <p className="mt-2 text-sm text-slate-600">
            {summary.totalDocuments} document
            {summary.totalDocuments === 1 ? "" : "s"} · {summary.readyDocuments}{" "}
            indexed
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Only indexed documents are used when asking questions in this project.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={`/projects/${project.id}/documents`}
              className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium hover:bg-slate-50"
            >
              Manage documents
            </Link>
            {summary.doneTasks > 0 ? (
              <Badge tone="success">{summary.doneTasks} done</Badge>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
