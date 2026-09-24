import { nextDiscoveryStep, type DiscoveryCounts, type DiscoveryStep } from "@/lib/pm/discovery";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Check } from "lucide-react";
import { DeliveryToggle } from "@/components/delivery-toggle";
import {
  Badge,
  Card,
  FOCUS_RING,
  LinkButton,
  ProgressBar,
  SectionHeader,
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

/** One stage of the discovery strip. Done stages carry a check, not a colour alone. */
function DiscoveryStage({
  index,
  label,
  value,
  hint,
  done,
  href,
}: {
  index: number;
  label: string;
  value: string;
  hint?: string;
  done: boolean;
  href: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className={cn(
          "flex h-full items-start gap-3 rounded-xl border bg-white p-4 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50",
          FOCUS_RING,
          done ? "border-emerald-200" : "border-slate-200",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold",
            done ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500",
          )}
        >
          {done ? <Check className="size-3.5" /> : index}
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-medium text-slate-500">
            {label}
            {done ? <span className="sr-only"> (done)</span> : null}
          </span>
          <span className="block text-sm font-semibold text-slate-900 tabular-nums">
            {value}
          </span>
          {hint ? (
            <span className="mt-0.5 block text-xs text-amber-700">{hint}</span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}

/**
 * The words for each step. Kept beside the page rather than in discovery.ts,
 * which decides *which* step applies and stays free of copy and routes.
 */
function nextStepCopy(
  step: DiscoveryStep,
  counts: DiscoveryCounts,
  base: string,
): { title: string; description: string; cta: string; href: string } {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  switch (step) {
    case "upload":
      return {
        title: "Upload the client’s documents",
        description:
          "Briefs, statements of work, meeting notes, or emails saved as PDF, Word, Markdown, or text. Every requirement ScopePilot drafts will cite them.",
        cta: "Upload documents",
        href: `${base}/documents`,
      };
    case "wait_indexing":
      return {
        title: "Your documents are being indexed",
        description:
          "This usually takes under a minute. Extraction opens as soon as one document is ready.",
        cta: "View documents",
        href: `${base}/documents`,
      };
    case "extract":
      return {
        title: "Extract the requirements",
        description:
          "ScopePilot reads the indexed documents and drafts cited requirements for you to check. Nothing counts as agreed until you say so.",
        cta: "Extract requirements",
        href: `${base}/requirements`,
      };
    case "review":
      return {
        title: `Review ${plural(counts.toReview, "draft requirement")}`,
        description:
          "Check each one against its source, then mark it Validated, Agreed, or Ask client — or reject it.",
        cta: "Start reviewing",
        href: `${base}/requirements?filter=draft`,
      };
    case "clarify":
      return {
        title: `${plural(counts.askClient, "question")} for the client`,
        description:
          "Take these back to the client. Update each requirement once it is answered.",
        cta: "Open questions",
        href: `${base}/requirements?filter=needs_clarification`,
      };
    case "agree":
      return {
        title: `${plural(counts.validated, "requirement")} waiting for client agreement`,
        description:
          "You have checked these. Mark them Agreed once the client confirms.",
        cta: "Open validated",
        href: `${base}/requirements?filter=validated`,
      };
    case "sign_off":
      return {
        title: `${plural(counts.agreed, "requirement")} agreed`,
        description:
          "The scope is agreed. Share it with the client for sign-off, or add new documents as the project evolves — new extractions are checked against this register.",
        cta: "View agreed scope",
        href: `${base}/requirements?filter=approved`,
      };
  }
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

  const byStatus = summary.requirementsByStatus;
  const discovery: DiscoveryCounts = {
    documents: summary.totalDocuments,
    readyDocuments: summary.readyDocuments,
    toReview: byStatus.draft,
    askClient: byStatus.needs_clarification,
    validated: byStatus.validated,
    agreed: byStatus.approved,
    rejected: byStatus.rejected,
  };
  const step = nextDiscoveryStep(discovery);
  const next = nextStepCopy(step, discovery, base);
  const live =
    byStatus.draft +
    byStatus.needs_clarification +
    byStatus.validated +
    byStatus.approved;

  return (
    <div className="space-y-6">
      <Card className="flex flex-wrap items-center justify-between gap-4 border-slate-300 p-5">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            Next step
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">
            {next.title}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-pretty text-slate-600">
            {next.description}
          </p>
        </div>
        <LinkButton href={next.href}>
          {next.cta}
          <ArrowRight className="size-4" aria-hidden />
        </LinkButton>
      </Card>

      <ol
        aria-label="Discovery progress"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <DiscoveryStage
          index={1}
          label="Documents"
          value={`${summary.readyDocuments} indexed`}
          hint={
            summary.totalDocuments > summary.readyDocuments
              ? `${summary.totalDocuments - summary.readyDocuments} still processing`
              : undefined
          }
          done={summary.readyDocuments > 0}
          href={`${base}/documents`}
        />
        <DiscoveryStage
          index={2}
          label="Extracted"
          value={`${live} requirement${live === 1 ? "" : "s"}`}
          done={live > 0}
          href={`${base}/requirements`}
        />
        <DiscoveryStage
          index={3}
          label="Reviewed"
          value={`${live - byStatus.draft} of ${live}`}
          hint={
            byStatus.needs_clarification > 0
              ? `${byStatus.needs_clarification} waiting on the client`
              : undefined
          }
          done={live > 0 && byStatus.draft === 0}
          href={`${base}/requirements?filter=draft`}
        />
        <DiscoveryStage
          index={4}
          label="Agreed"
          value={`${byStatus.approved} of ${live}`}
          done={live > 0 && byStatus.approved === live}
          href={`${base}/requirements?filter=approved`}
        />
      </ol>

      {project.deliveryEnabled ? (
        <section aria-label="Delivery" className="space-y-4">
          <SectionHeader
            title="Delivery"
            description="Tasks, milestones, and risks for this project."
          >
            <DeliveryToggle
              projectId={project.id}
              enabled
              variant="ghost"
            />
          </SectionHeader>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Scope coverage"
          value={summary.approvedRequirements === 0 ? "—" : `${coverage}%`}
          href={`${base}/requirements?filter=approved`}
          hint={
            summary.approvedRequirements === 0 ? (
              "Nothing agreed yet"
            ) : (
              <>
                <ProgressBar
                  percent={coverage}
                  label="Agreed requirements with a delivery task"
                  className="mb-1.5"
                />
                {coveredRequirements} of {summary.approvedRequirements} agreed
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
          hint="Agreed scope with no delivery task"
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
      </div>
        </section>
      ) : (
        <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">
              Delivery tools are off
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-pretty text-slate-600">
              This project is set up for requirements discovery. Turn delivery
              tools on to plan tasks, a timeline, risks, and weekly reports
              here — or export the agreed requirements to the tool your team
              already uses.
            </p>
          </div>
          <DeliveryToggle projectId={project.id} enabled={false} />
        </Card>
      )}
    </div>
  );
}
