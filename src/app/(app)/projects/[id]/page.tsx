import { nextDiscoveryStep, type DiscoveryCounts, type DiscoveryStep } from "@/lib/pm/discovery";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Check } from "lucide-react";
import { SectionToggle } from "@/components/section-toggle";
import {
  Badge,
  Card,
  FOCUS_RING_INSET,
  LinkButton,
  ProgressBar,
  SectionHeader,
  StatCard,
  StatGroup,
} from "@/components/ui";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { sortRisks, worstRiskLevel } from "@/lib/pm/filters";
import { percentOf } from "@/lib/pm/progress";
import { getLocale, getT } from "@/lib/i18n/server";
import { intlLocale } from "@/lib/i18n/locales";
import type { Translate } from "@/lib/i18n/translate";
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
import { getViewerTimeZone, getViewerToday } from "@/lib/viewer";

export const dynamic = "force-dynamic";

const LIST_LIMIT = 5;

const LEVEL_TONE = { low: "neutral", medium: "warning", high: "danger" } as const;
const HEALTH_TONE = { green: "success", amber: "warning", red: "danger" } as const;

/**
 * One titled list with an optional "see all" link. Every panel on this page
 * answers one question and leads to the tab where it can be acted on.
 *
 * A panel is a cell of a shared card (`PanelPair`), not a card of its own: the
 * page used to draw up to sixteen bordered boxes, and a pair of lists that are
 * read together reads better on one surface.
 */
function OverviewPanel({
  title,
  href,
  linkLabel,
  children,
}: {
  title: string;
  href?: string;
  linkLabel: string;
  children: React.ReactNode;
}) {
  return (
    // min-w-0 for the same reason as the dashboard's lists: a grid item is
    // otherwise as wide as its longest truncated title.
    <div className="flex min-w-0 flex-col bg-white p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-sand-900">{title}</h3>
        {href ? (
          <Link
            href={href}
            className="inline-flex shrink-0 items-center gap-1 rounded text-xs font-medium text-sand-500 hover:text-brand-700"
          >
            {linkLabel}
            <ArrowRight className="size-3" aria-hidden />
          </Link>
        ) : null}
      </div>
      <div className="mt-3 flex-1">{children}</div>
    </div>
  );
}

/** Panels side by side on one card, split by a hairline (see `StatGroup`). */
function PanelPair({ children }: { children: React.ReactNode }) {
  return (
    <Card className="grid gap-px overflow-hidden bg-sand-100 lg:grid-cols-2">
      {children}
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
  doneLabel,
}: {
  index: number;
  label: string;
  value: string;
  hint?: string;
  done: boolean;
  href: string;
  doneLabel: string;
}) {
  return (
    <li className="bg-white">
      <Link
        href={href}
        className={cn(
          "flex h-full items-start gap-3 p-4 transition-colors hover:bg-sand-50",
          FOCUS_RING_INSET,
        )}
      >
        <span
          aria-hidden
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold",
            done ? "bg-emerald-600 text-white" : "bg-sand-100 text-sand-500",
          )}
        >
          {done ? <Check className="size-3.5" /> : index}
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-medium text-sand-500">
            {label}
            {done ? <span className="sr-only"> {doneLabel}</span> : null}
          </span>
          <span className="block text-sm font-semibold text-sand-900 tabular-nums">
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
  projectId: string,
  t: Translate,
): { title: string; description: string; cta: string; href: string } {
  const base = `/projects/${projectId}`;
  const copy = (count?: number) => ({
    title:
      count === undefined
        ? t(`overview.steps.${step as "upload" | "wait_indexing" | "extract"}.title`)
        : t(`overview.steps.${step as "review" | "clarify" | "agree" | "sign_off"}.title`, {
            count,
          }),
    description: t(`overview.steps.${step}.description`),
    cta: t(`overview.steps.${step}.cta`),
  });
  switch (step) {
    case "upload":
      return { ...copy(), href: `${base}/documents` };
    case "wait_indexing":
      return { ...copy(), href: `${base}/documents` };
    case "extract":
      return { ...copy(), href: `${base}/requirements` };
    case "review":
      return { ...copy(counts.toReview), href: `${base}/requirements?filter=draft` };
    case "clarify":
      return {
        ...copy(counts.askClient),
        href: `/print/requirements/${projectId}?pack=questions`,
      };
    case "agree":
      return { ...copy(counts.validated), href: `${base}/requirements?filter=validated` };
    case "sign_off":
      return {
        ...copy(counts.agreed),
        href: `/print/requirements/${projectId}?pack=signoff`,
      };
  }
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-sand-500">{children}</p>;
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

  // The viewer's day: every use below is a day comparison.
  const [now, t, locale, timeZone] = await Promise.all([
    getViewerToday(),
    getT(),
    getLocale(),
    getViewerTimeZone(),
  ]);
  const dateLocale = intlLocale(locale);
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
  const next = nextStepCopy(step, discovery, project.id, t);
  const live =
    byStatus.draft +
    byStatus.needs_clarification +
    byStatus.validated +
    byStatus.approved;

  const overdueList = (
    <OverviewPanel
      title={t("overview.overdueTitle")}
      href={
        summary.overdueTasks > overdueTasks.length
          ? `${base}/tasks?filter=overdue`
          : undefined
      }
      linkLabel={t("overview.allCount", { count: summary.overdueTasks })}
    >
      {overdueTasks.length === 0 ? (
        <Quiet>{t("overview.overdueEmpty")}</Quiet>
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
                {task.dueDate ? formatDay(task.dueDate, dateLocale) : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </OverviewPanel>
  );

  const blockedList = (
    <OverviewPanel
      title={t("overview.blockedTitle")}
      href={
        summary.blockedTasks > blockedTasks.length
          ? `${base}/tasks?filter=blocked`
          : undefined
      }
      linkLabel={t("overview.allCount", { count: summary.blockedTasks })}
    >
      {blockedTasks.length === 0 ? (
        <Quiet>{t("overview.blockedEmpty")}</Quiet>
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
    </OverviewPanel>
  );

  // Layers that are switched off, offered in one card at the bottom rather
  // than as an empty section each.
  const offLayers = [
    ...(project.discoveryEnabled ? [] : (["discovery"] as const)),
    ...(project.deliveryEnabled ? [] : (["delivery"] as const)),
  ];

  return (
    <div className="space-y-10">
      {project.discoveryEnabled ? (
        // The next step and the four stages it comes from are one card: the
        // stages used to be four more bordered tiles under it.
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-brand-100/80 bg-brand-50/60 p-6">
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">
                {t("overview.nextStep")}
              </p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-sand-900">
                {next.title}
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-pretty text-sand-600">
                {next.description}
              </p>
            </div>
            <LinkButton href={next.href}>
              {next.cta}
              <ArrowRight className="size-4" aria-hidden />
            </LinkButton>
          </div>

          <ol
            aria-label={t("overview.discoveryProgress")}
            className="grid gap-px bg-sand-100 sm:grid-cols-2 lg:grid-cols-4"
          >
            <DiscoveryStage
              index={1}
              label={t("overview.stages.documents")}
              value={t("overview.stages.documentsValue", { count: summary.readyDocuments })}
              hint={
                summary.totalDocuments > summary.readyDocuments
                  ? t("overview.stages.processing", {
                      count: summary.totalDocuments - summary.readyDocuments,
                    })
                  : undefined
              }
              doneLabel={t("overview.done")}
              done={summary.readyDocuments > 0}
              href={`${base}/documents`}
            />
            <DiscoveryStage
              index={2}
              label={t("overview.stages.extracted")}
              value={t("overview.stages.extractedValue", { count: live })}
              doneLabel={t("overview.done")}
              done={live > 0}
              href={`${base}/requirements`}
            />
            <DiscoveryStage
              index={3}
              label={t("overview.stages.reviewed")}
              value={t("overview.stages.ofTotal", { done: live - byStatus.draft, total: live })}
              hint={
                byStatus.needs_clarification > 0
                  ? t("overview.stages.waitingClient", { count: byStatus.needs_clarification })
                  : undefined
              }
              doneLabel={t("overview.done")}
              done={live > 0 && byStatus.draft === 0}
              href={`${base}/requirements?filter=draft`}
            />
            <DiscoveryStage
              index={4}
              label={t("overview.stages.agreed")}
              value={t("overview.stages.ofTotal", { done: byStatus.approved, total: live })}
              doneLabel={t("overview.done")}
              done={live > 0 && byStatus.approved === live}
              href={`${base}/requirements?filter=approved`}
            />
          </ol>
        </Card>
      ) : null}

      <section aria-label={t("project.tabs.tasks")} className="space-y-4">
        <SectionHeader title={t("project.tabs.tasks")} />
        <StatGroup className="sm:grid-cols-3">
          <StatCard
            plain
            label={t("overview.completion")}
            value={totalTasks === 0 ? "—" : `${completion}%`}
            href={`${base}/tasks`}
            hint={
              totalTasks === 0 ? (
                t("overview.noTasks")
              ) : (
                <>
                  <ProgressBar
                    percent={completion}
                    label={t("overview.tasksDone")}
                    className="mb-1.5"
                  />
                  {t("overview.doneOf", { done: summary.doneTasks, total: totalTasks })}
                </>
              )
            }
          />
          <StatCard
            plain
            label={t("overview.overdueTitle")}
            value={summary.overdueTasks}
            tone="danger"
            href={`${base}/tasks?filter=overdue`}
            hint={
              summary.dueSoonTasks > 0
                ? t("overview.dueSoonMore", { count: summary.dueSoonTasks })
                : t("overview.nothingThisWeek")
            }
          />
          <StatCard
            plain
            label={t("overview.blockedTitle")}
            value={summary.blockedTasks}
            tone="warning"
            href={`${base}/tasks?filter=blocked`}
          />
        </StatGroup>
        <PanelPair>
          {overdueList}
          {blockedList}
        </PanelPair>
      </section>

      {project.deliveryEnabled ? (
        <section aria-label={t("overview.delivery")} className="space-y-4">
          <SectionHeader
            title={t("overview.delivery")}
            description={t("overview.deliveryLead")}
          >
            <SectionToggle
              projectId={project.id}
              section="delivery"
              enabled
              variant="ghost"
            />
          </SectionHeader>
          <StatGroup className={project.discoveryEnabled ? "sm:grid-cols-3" : undefined}>
            {project.discoveryEnabled ? (
              <>
                <StatCard
                  plain
                  label={t("overview.coverage")}
                  value={summary.approvedRequirements === 0 ? "—" : `${coverage}%`}
                  href={`${base}/requirements?filter=approved`}
                  hint={
                    summary.approvedRequirements === 0 ? (
                      t("overview.nothingAgreed")
                    ) : (
                      <>
                        <ProgressBar
                          percent={coverage}
                          label={t("overview.coverageBar")}
                          className="mb-1.5"
                        />
                        {t("overview.coverageHint", {
                          covered: coveredRequirements,
                          agreed: summary.approvedRequirements,
                        })}
                      </>
                    )
                  }
                />
                <StatCard
                  plain
                  label={t("overview.uncovered")}
                  value={summary.uncoveredRequirements}
                  tone="danger"
                  href={`${base}/requirements?filter=gaps`}
                  hint={t("overview.uncoveredHint")}
                />
              </>
            ) : null}
            <StatCard
              plain
              label={t("overview.openRisks")}
              value={summary.openRisks}
              tone={highRisks > 0 ? "danger" : undefined}
              href={`${base}/risks`}
              hint={highRisks > 0 ? t("overview.highRisks", { count: highRisks }) : undefined}
            />
          </StatGroup>
          <PanelPair>
            <OverviewPanel
              title={t("overview.milestonesTitle")}
              href={`${base}/timeline`}
              linkLabel={t("overview.timeline")}
            >
              {nextMilestones.length === 0 ? (
                <Quiet>{t("overview.milestonesEmpty")}</Quiet>
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
                            late ? "font-medium text-red-700" : "text-sand-500",
                          )}
                        >
                          {milestone.targetDate
                            ? formatDay(milestone.targetDate, dateLocale)
                            : t("common.noDate")}
                          {late ? (
                            <span className="sr-only"> {t("overview.overdue")}</span>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </OverviewPanel>

            <OverviewPanel
              title={t("overview.risksTitle")}
              href={`${base}/risks`}
              linkLabel={t("overview.allRisks")}
            >
              {topRisks.length === 0 ? (
                <Quiet>{t("overview.risksEmpty")}</Quiet>
              ) : (
                <ul className="space-y-2">
                  {topRisks.map((risk) => (
                    <li key={risk.id} className="flex items-start justify-between gap-3 text-sm">
                      <span className="min-w-0 line-clamp-2">{risk.description}</span>
                      <Badge tone={LEVEL_TONE[worstRiskLevel(risk)]} className="shrink-0">
                        {t("overview.riskLevels", {
                          impact: t(`riskLevel.${risk.impact}`),
                          likelihood: t(`riskLevel.${risk.likelihood}`),
                        })}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </OverviewPanel>
          </PanelPair>

          <Card className="overflow-hidden">
            <OverviewPanel
              title={t("overview.reportTitle")}
              href={`${base}/reports`}
              linkLabel={report ? t("overview.open") : t("overview.reports")}
            >
              {report && latestReport ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-sand-500">
                    <Badge tone={HEALTH_TONE[report.health]}>
                      {t(`reportHealth.${report.health}`)}
                    </Badge>
                    {t("overview.reportMeta", {
                      start: report.period.start,
                      end: report.period.end,
                      date: formatDate(latestReport.createdAt, dateLocale, timeZone),
                    })}
                  </div>
                  <p className="line-clamp-3 text-sm text-sand-700">
                    {report.narrative}
                  </p>
                </div>
              ) : (
                <Quiet>{t("overview.reportEmpty")}</Quiet>
              )}
            </OverviewPanel>
          </Card>
        </section>
      ) : null}

      {offLayers.length > 0 ? (
        <Card className="divide-y divide-sand-100">
          <h2 className="px-5 pt-5 pb-3 text-base font-semibold text-sand-900">
            {t("project.layers.title")}
          </h2>
          {offLayers.map((layer) => (
            <div
              key={layer}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
            >
              <div className="min-w-0">
                <h3 className="text-sm font-medium text-sand-900">
                  {t(
                    layer === "discovery"
                      ? "project.layers.discoveryTitle"
                      : "project.layers.deliveryTitle",
                  )}
                </h3>
                <p className="mt-0.5 max-w-2xl text-sm text-pretty text-sand-600">
                  {t(
                    layer === "discovery"
                      ? "project.layers.discoveryBody"
                      : "project.layers.deliveryBody",
                  )}
                </p>
              </div>
              <SectionToggle projectId={project.id} section={layer} enabled={false} />
            </div>
          ))}
        </Card>
      ) : null}
    </div>
  );
}
