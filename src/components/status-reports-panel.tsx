"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  FOCUS_RING,
  SectionHeader,
  Spinner,
} from "@/components/ui";
import { useDateLocale, useT } from "@/components/i18n-provider";
import {
  reportItemStatus,
  statusReportToMarkdown,
  type SavedStatusReport,
  type StatusReportItem,
} from "@/lib/reports/status-report";
import { labelOr } from "@/lib/i18n/translate";
import { formatDate } from "@/lib/utils";
import { Download } from "lucide-react";

interface ReportRun {
  id: string;
  projectId: string;
  model: string;
  promptVersion: string;
  status: string;
  errorMessage: string | null;
  latencyMs: number | null;
  createdAt: string;
  report: SavedStatusReport | null;
}

const HEALTH_TONE = {
  green: "success",
  amber: "warning",
  red: "danger",
} as const;

function ReportSection({
  title,
  items,
}: {
  title: string;
  items: StatusReportItem[];
}) {
  const t = useT();
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-slate-400 tabular-nums">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">{t("reports.nothingInPeriod")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {items.map((item) => (
            <li key={`${item.kind}-${item.id}`} className="py-2.5 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                <Link href={item.href} className="text-sm font-medium hover:underline">
                  {item.title}
                </Link>
                <Badge tone={item.kind === "risk" ? "warning" : "neutral"}>
                  {t(`reports.kinds.${item.kind}`)}
                </Badge>
                <span className="text-xs text-slate-500">{reportItemStatus(item, t)}</span>
                {item.date ? (
                  <span className="ml-auto text-xs text-slate-500">{item.date}</span>
                ) : null}
              </div>
              {item.detail ? (
                <p className="mt-1 text-xs text-pretty text-slate-500">{item.detail}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ReportView({ run }: { run: ReportRun }) {
  const [copied, setCopied] = useState(false);
  const t = useT();
  const dateLocale = useDateLocale();
  if (!run.report) return null;
  const report = run.report;

  function downloadMarkdown() {
    const blob = new Blob([statusReportToMarkdown(report, t)], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `status-report-${report.period.start}-to-${report.period.end}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(statusReportToMarkdown(report, t));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  const stats = [
    [t("reports.stats.openTasks"), `${report.counts.openTasks}/${report.counts.tasks}`],
    [
      t("reports.stats.openMilestones"),
      `${report.counts.openMilestones}/${report.counts.milestones}`,
    ],
    [
      t("reports.stats.completed"),
      report.counts.completedTasksInPeriod +
        report.counts.completedMilestonesInPeriod,
    ],
    [t("reports.stats.blockers"), report.counts.blockers],
    [t("reports.stats.overdue"), report.counts.overdue],
    [t("reports.stats.upcoming"), report.counts.upcoming],
    [t("reports.stats.activeRisks"), report.counts.activeRisks],
    [t("reports.stats.dependencies"), report.counts.dependencyBlockers],
  ] as const;

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={HEALTH_TONE[report.health]}>
                {t("reports.health", { health: t(`reportHealth.${report.health}`) })}
              </Badge>
              <span className="text-xs text-slate-500">
                {report.period.start} – {report.period.end}
              </span>
            </div>
            <h2 className="mt-3 text-lg font-semibold">{t("reports.executiveSummary")}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={copyMarkdown}>
              <span aria-live="polite">{copied ? t("reports.copied") : t("reports.copy")}</span>
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={downloadMarkdown}
            >
              <Download className="size-3.5" aria-hidden />
              {t("reports.download")}
            </Button>
          </div>
        </div>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-pretty text-slate-700">
          {report.narrative}
        </p>
        <p className="mt-3 text-xs text-slate-400">
          {t("reports.generatedMeta", {
            date: formatDate(run.createdAt, dateLocale),
            model: run.model,
            latency:
              run.latencyMs === null
                ? t("reports.latencyUnavailable")
                : `${(run.latencyMs / 1000).toFixed(1)}s`,
          })}
        </p>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {stats.map(([label, value]) => (
          <Card key={label} className="p-3">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ReportSection title={t("reports.sections.completed")} items={report.sections.completed} />
        <ReportSection title={t("reports.sections.blockers")} items={report.sections.blockers} />
        <ReportSection title={t("reports.sections.overdue")} items={report.sections.overdue} />
        <ReportSection title={t("reports.sections.upcoming")} items={report.sections.upcoming} />
        <ReportSection title={t("reports.sections.risks")} items={report.sections.risks} />
        <ReportSection
          title={t("reports.sections.dependencyBlockers")}
          items={report.sections.dependencyBlockers}
        />
      </div>

      <Card className="p-4">
        <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          {t("reports.narrativeSources")}
        </h3>
        <div className="mt-3 space-y-2">
          {report.citations.map((citation) => (
            <div
              key={`${citation.kind}-${citation.href}-${citation.title}-${citation.observedAt}`}
              className="rounded-lg border border-blue-200 bg-blue-50/40 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="info">{t(`reports.kinds.${citation.kind}`)}</Badge>
                <Link href={citation.href} className="text-xs font-medium hover:underline">
                  {citation.title}
                </Link>
                <span className="ml-auto text-xs text-slate-400">
                  {t("reports.observed", { date: formatDate(citation.observedAt, dateLocale) })}
                </span>
              </div>
              <blockquote className="mt-2 border-l-2 border-blue-300 pl-3 text-xs text-slate-600 italic">
                {citation.excerpt}
              </blockquote>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

export function StatusReportsPanel({
  projectId,
  initialReports,
}: {
  projectId: string;
  initialReports: ReportRun[];
}) {
  const [runs, setRuns] = useState(initialReports);
  const [selectedId, setSelectedId] = useState(
    initialReports.find((run) => run.report)?.id ?? "",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useT();
  const dateLocale = useDateLocale();
  const selected = useMemo(
    () => runs.find((run) => run.id === selectedId && run.report) ?? null,
    [runs, selectedId],
  );

  async function generate() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/status-reports`, {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? t("reports.generateFailed"));
        // Generation failures are audit records too. Refresh the immutable run
        // history so the failed attempt is visible without a page reload.
        const historyResponse = await fetch(
          `/api/projects/${projectId}/status-reports`,
        ).catch(() => null);
        if (historyResponse?.ok) {
          const history = await historyResponse.json().catch(() => null);
          if (Array.isArray(history?.reports)) setRuns(history.reports);
        }
        return;
      }
      setRuns((previous) => [data.report, ...previous]);
      setSelectedId(data.report.id);
    } catch {
      setError(t("reports.unreachable"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title={t("reports.title")}
        description={t("reports.lead")}
      >
        <Button type="button" onClick={generate} disabled={pending}>
          {pending ? (
            <>
              <Spinner className="border-white/40 border-t-white" />
              {t("reports.generating")}
            </>
          ) : (
            t("reports.generate")
          )}
        </Button>
      </SectionHeader>

      {error ? <ErrorState message={error} /> : null}

      {runs.length > 0 ? (
        <Card className="p-3">
          <p className="px-1 pb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            {t("reports.history")}
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {runs.map((run) => (
              <button
                key={run.id}
                type="button"
                disabled={!run.report}
                aria-pressed={selectedId === run.id}
                onClick={() => setSelectedId(run.id)}
                className={`min-w-48 rounded-lg border px-3 py-2 text-left text-xs transition-colors disabled:opacity-60 ${FOCUS_RING} ${
                  selectedId === run.id
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <span className="block font-medium">
                  {formatDate(run.createdAt, dateLocale)}
                </span>
                <span className={selectedId === run.id ? "text-slate-300" : "text-slate-500"}>
                  {run.report
                    ? `${run.report.period.start} – ${run.report.period.end}`
                    : `${labelOr(t, `runStatus.${run.status}`, run.status)}: ${
                        run.errorMessage ?? t("reports.noOutput")
                      }`}
                </span>
              </button>
            ))}
          </div>
        </Card>
      ) : null}

      {selected ? (
        <ReportView run={selected} />
      ) : (
        <EmptyState
          title={t("reports.emptyTitle")}
          description={t("reports.emptyBody")}
        />
      )}
    </div>
  );
}
