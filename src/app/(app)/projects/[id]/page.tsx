import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import {
  Badge,
  Card,
  EmptyState,
  LinkButton,
  ProgressBar,
  StatCard,
} from "@/components/ui";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { sortRisks, worstRiskLevel } from "@/lib/pm/filters";
import { percentOf } from "@/lib/pm/progress";
import { getScopedProject } from "@/lib/pm/project";
import { getProjectSummary } from "@/lib/pm/summary";
import {
  blockedTaskWhere,
  isOverdue,
  officialRecordWhere,
  overdueTaskWhere,
} from "@/lib/pm/rules";
import { getLatestStatusReport } from "@/lib/reports/service";
import { cn, formatDate, formatDay } from "@/lib/utils";

export const dynamic = "force-dynamic";

const LIST_LIMIT = 5;

const LEVEL_TONE = { low: "neutral", medium: "warning", high: "danger" } as const;
const HEALTH_TONE = { green: "success", amber: "warning", red: "danger" } as const;

/**
 * One titled card with an optional "see all" link. Every card on this page
 * answers one question and leads to the tab where it can be acted on.
 */
function OverviewCard({
  title,
  href,
  linkLabel = "View all",
  children,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {href ? (
          <Link
            href={href}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900"
          >
            {linkLabel}
            <ArrowRight className="size-3" aria-hidden />
          </Link>
        ) : null}
      </div>
      <div className="mt-3 flex-1">{children}</div>
    </Card>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-slate-500">{children}</p>;
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
  const [
    summary,
    overdueTasks,
    nextMilestones,
    blockedTasks,
    activeRisks,
    latestReport,
  ] = await Promise.all([
    getProjectSummary(workspaceId, project.id, now),
    prisma.task.findMany({
      where: overdueTaskWhere(workspaceId, now, project.id),
      orderBy: { dueDate: "asc" },
      take: LIST_LIMIT,
      select: { id: true, title: true, dueDate: true },
    }),
    prisma.milestone.findMany({
      where: officialRecordWhere({
        workspaceId,
        projectId: project.id,
        status: { not: "completed" as const },
      }),
      orderBy: [{ targetDate: "asc" }, { createdAt: "asc" }],
      take: LIST_LIMIT,
      select: { id: true, title: true, targetDate: true, status: true },
    }),
    prisma.task.findMany({
      where: blockedTaskWhere(workspaceId, project.id),
      orderBy: { createdAt: "asc" },
      take: LIST_LIMIT,
      select: { id: true, title: true },
    }),
    // Ranked in memory: exposure is a product of two enum columns, which the
    // database cannot order by. A project carries tens of risks, not thousands.
    prisma.projectRisk.findMany({
      where: officialRecordWhere({
        workspaceId,
        projectId: project.id,
        status: { in: ["open" as const, "monitoring" as const] },
      }),
      orderBy: { createdAt: "desc" },
      select: { id: true, description: true, impact: true, likelihood: true },
    }),
    getLatestStatusReport(workspaceId, project.id),
  ]);

  const base = `/projects/${project.id}`;
  const topRisks = sortRisks(activeRisks, "exposure").slice(0, 3);
  const highRisks = activeRisks.filter(
    (risk) => worstRiskLevel(risk) === "high",
  ).length;
  const totalTasks = summary.openTasks + summary.doneTasks;
  const completion = percentOf(summary.doneTasks, totalTasks);
  const coveredRequirements =
    summary.approvedRequirements - summary.uncoveredRequirements;
  const coverage = percentOf(coveredRequirements, summary.approvedRequirements);
  const report = latestReport?.report ?? null;

  const nothingYet =
    summary.openTasks === 0 &&
    summary.doneTasks === 0 &&
    summary.openMilestones === 0 &&
    summary.openRisks === 0 &&
    summary.totalRequirements === 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Scope coverage"
          value={summary.approvedRequirements === 0 ? "—" : `${coverage}%`}
          href={`${base}/requirements?filter=approved`}
          hint={
            summary.approvedRequirements === 0 ? (
              "No requirement approved yet"
            ) : (
              <>
                <ProgressBar
                  percent={coverage}
                  label="Approved requirements with a delivery task"
                  className="mb-1.5"
                />
                {coveredRequirements} of {summary.approvedRequirements} approved
                have a task
              </>
            )
          }
        />
        <StatCard
          label="Uncovered requirements"
          value={summary.uncoveredRequirements}
          tone="danger"
          href={`${base}/requirements?filter=gaps`}
          hint="Approved scope with no delivery task"
        />
        <StatCard
          label="Task completion"
          value={totalTasks === 0 ? "—" : `${completion}%`}
          href={`${base}/tasks`}
          hint={
            totalTasks === 0 ? (
              "No tasks yet"
            ) : (
              <>
                <ProgressBar
                  percent={completion}
                  label="Tasks done"
                  className="mb-1.5"
                />
                {summary.doneTasks} of {totalTasks} done
              </>
            )
          }
        />
        <StatCard
          label="Overdue tasks"
          value={summary.overdueTasks}
          tone="danger"
          href={`${base}/tasks?filter=overdue`}
          hint={
            summary.dueSoonTasks > 0
              ? `${summary.dueSoonTasks} more due in 7 days`
              : "Nothing else due this week"
          }
        />
        <StatCard
          label="Blocked tasks"
          value={summary.blockedTasks}
          tone="warning"
          href={`${base}/tasks?filter=blocked`}
        />
        <StatCard
          label="Open risks"
          value={summary.openRisks}
          tone={highRisks > 0 ? "danger" : undefined}
          href={`${base}/risks`}
          hint={highRisks > 0 ? `${highRisks} rated high` : undefined}
        />
      </div>

      {summary.pendingPlanRuns > 0 || summary.undecidedRequirements > 0 ? (
        <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 border-amber-200 bg-amber-50/60 px-5 py-3">
          <p className="text-sm font-semibold text-amber-900">
            Waiting on a decision
          </p>
          {summary.undecidedRequirements > 0 ? (
            <Link
              href={`${base}/requirements`}
              className="text-sm text-amber-900 underline-offset-2 hover:underline"
            >
              {summary.undecidedRequirements} requirement
              {summary.undecidedRequirements === 1 ? "" : "s"} in draft or
              needing clarification
            </Link>
          ) : null}
          {summary.pendingPlanRuns > 0 ? (
            <Link
              href={`${base}/review`}
              className="text-sm text-amber-900 underline-offset-2 hover:underline"
            >
              {summary.pendingPlanRuns} generated plan
              {summary.pendingPlanRuns === 1 ? "" : "s"} to review
            </Link>
          ) : null}
        </Card>
      ) : null}

      {nothingYet ? (
        <EmptyState
          title="This project has no scope yet"
          description="Start with the requirements — extract drafts from a document or record them by hand — then create the tasks, milestones, and risks that deliver them."
          action={
            <LinkButton href={`${base}/requirements`}>
              Open Requirements
            </LinkButton>
          }
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <OverviewCard
          title="Overdue tasks"
          href={
            summary.overdueTasks > overdueTasks.length
              ? `${base}/tasks?filter=overdue`
              : undefined
          }
          linkLabel={`All ${summary.overdueTasks}`}
        >
          {overdueTasks.length === 0 ? (
            <Quiet>Nothing is past its due date.</Quiet>
          ) : (
            <ul className="space-y-2">
              {overdueTasks.map((task) => (
                <li key={task.id} className="flex justify-between gap-3 text-sm">
                  <Link
                    href={`${base}/tasks?task=${task.id}`}
                    className="min-w-0 truncate hover:underline"
                  >
                    {task.title}
                  </Link>
                  <span className="shrink-0 text-xs text-red-700">
                    {task.dueDate ? formatDay(task.dueDate) : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </OverviewCard>

        <OverviewCard
          title="Blocked tasks"
          href={
            summary.blockedTasks > blockedTasks.length
              ? `${base}/tasks?filter=blocked`
              : undefined
          }
          linkLabel={`All ${summary.blockedTasks}`}
        >
          {blockedTasks.length === 0 ? (
            <Quiet>Nothing is blocked.</Quiet>
          ) : (
            <ul className="space-y-2">
              {blockedTasks.map((task) => (
                <li key={task.id} className="truncate text-sm">
                  <Link
                    href={`${base}/tasks?task=${task.id}`}
                    className="hover:underline"
                  >
                    {task.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </OverviewCard>

        <OverviewCard title="Upcoming milestones" href={`${base}/timeline`} linkLabel="Timeline">
          {nextMilestones.length === 0 ? (
            <Quiet>No milestones recorded yet.</Quiet>
          ) : (
            <ul className="space-y-2">
              {nextMilestones.map((milestone) => {
                const late = isOverdue(
                  { date: milestone.targetDate, open: true },
                  now,
                );
                return (
                  <li
                    key={milestone.id}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="min-w-0 truncate">{milestone.title}</span>
                    <span
                      className={cn(
                        "shrink-0 text-xs",
                        late ? "font-medium text-red-700" : "text-slate-500",
                      )}
                    >
                      {milestone.targetDate
                        ? formatDay(milestone.targetDate)
                        : "No date"}
                      {late ? <span className="sr-only"> (overdue)</span> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </OverviewCard>

        <OverviewCard title="Top risks" href={`${base}/risks`} linkLabel="All risks">
          {topRisks.length === 0 ? (
            <Quiet>No open risks.</Quiet>
          ) : (
            <ul className="space-y-2">
              {topRisks.map((risk) => (
                <li key={risk.id} className="flex items-start justify-between gap-3 text-sm">
                  <span className="min-w-0 line-clamp-2">{risk.description}</span>
                  <Badge tone={LEVEL_TONE[worstRiskLevel(risk)]} className="shrink-0">
                    {risk.impact} · {risk.likelihood}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </OverviewCard>

        <OverviewCard
          title="Latest status report"
          href={`${base}/reports`}
          linkLabel={report ? "Open" : "Reports"}
        >
          {report && latestReport ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <Badge tone={HEALTH_TONE[report.health]}>
                  {report.health}
                </Badge>
                {report.period.start} – {report.period.end} · generated{" "}
                {formatDate(latestReport.createdAt)}
              </div>
              <p className="line-clamp-3 text-sm text-slate-700">
                {report.narrative}
              </p>
            </div>
          ) : (
            <Quiet>No weekly report yet. Generate one from the Reports tab.</Quiet>
          )}
        </OverviewCard>

        <OverviewCard
          title="Knowledge"
          href={`${base}/documents`}
          linkLabel="Manage documents"
        >
          <p className="text-sm text-slate-700">
            {summary.totalDocuments} document
            {summary.totalDocuments === 1 ? "" : "s"} · {summary.readyDocuments}{" "}
            indexed
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Only indexed documents are used when asking questions in this project.
          </p>
        </OverviewCard>
      </div>
    </div>
  );
}
