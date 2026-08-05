"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState, ErrorState, Spinner } from "@/components/ui";
import {
  statusReportToMarkdown,
  type SavedStatusReport,
  type StatusReportItem,
} from "@/lib/reports/status-report";
import { formatDate } from "@/lib/utils";

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
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-slate-400 tabular-nums">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">None.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {items.map((item) => (
            <li key={`${item.kind}-${item.id}`} className="py-2.5 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                <Link href={item.href} className="text-sm font-medium hover:underline">
                  {item.title}
                </Link>
                <Badge tone={item.kind === "risk" ? "warning" : "neutral"}>
                  {item.kind}
                </Badge>
                <span className="text-xs text-slate-500">
                  {item.status.replaceAll("_", " ")}
                </span>
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
  if (!run.report) return null;
  const report = run.report;

  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(statusReportToMarkdown(report));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  const stats = [
    ["Open tasks", `${report.counts.openTasks}/${report.counts.tasks}`],
    [
      "Open milestones",
      `${report.counts.openMilestones}/${report.counts.milestones}`,
    ],
    [
      "Completed",
      report.counts.completedTasksInPeriod +
        report.counts.completedMilestonesInPeriod,
    ],
    ["Blockers", report.counts.blockers],
    ["Overdue", report.counts.overdue],
    ["Upcoming", report.counts.upcoming],
    ["Active risks", report.counts.activeRisks],
    ["Dependencies", report.counts.dependencyBlockers],
  ] as const;

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={HEALTH_TONE[report.health]}>
                {report.health.toUpperCase()} health
              </Badge>
              <span className="text-xs text-slate-500">
                {report.period.start} – {report.period.end}
              </span>
            </div>
            <h2 className="mt-3 text-lg font-semibold">Executive summary</h2>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={copyMarkdown}>
            {copied ? "Copied" : "Copy as Markdown"}
          </Button>
        </div>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-pretty text-slate-700">
          {report.narrative}
        </p>
        <p className="mt-3 text-xs text-slate-400">
          Generated {formatDate(run.createdAt)} · {run.model} ·{" "}
          {run.latencyMs === null ? "latency unavailable" : `${(run.latencyMs / 1000).toFixed(1)}s`}
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
        <ReportSection title="Completed this period" items={report.sections.completed} />
        <ReportSection title="Current blockers" items={report.sections.blockers} />
        <ReportSection title="Overdue" items={report.sections.overdue} />
        <ReportSection title="Next seven days" items={report.sections.upcoming} />
        <ReportSection title="Open and monitoring risks" items={report.sections.risks} />
        <ReportSection
          title="Dependency blockers"
          items={report.sections.dependencyBlockers}
        />
      </div>

      <Card className="p-4">
        <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Narrative sources
        </h3>
        <div className="mt-3 space-y-2">
          {report.citations.map((citation) => (
            <div
              key={`${citation.kind}-${citation.href}-${citation.title}-${citation.observedAt}`}
              className="rounded-lg border border-blue-200 bg-blue-50/40 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="info">{citation.kind.replaceAll("_", " ")}</Badge>
                <Link href={citation.href} className="text-xs font-medium hover:underline">
                  {citation.title}
                </Link>
                <span className="ml-auto text-xs text-slate-400">
                  observed {formatDate(citation.observedAt)}
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
        setError(data.error ?? "Could not generate the status report.");
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
      setError("Could not reach the server. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Weekly status reports</h2>
          <p className="mt-1 text-sm text-slate-600">
            Exact project sections with a concise, cited executive narrative.
          </p>
        </div>
        <Button type="button" onClick={generate} disabled={pending}>
          {pending ? (
            <>
              <Spinner className="border-white/40 border-t-white" />
              Generating…
            </>
          ) : (
            "Generate report"
          )}
        </Button>
      </div>

      {error ? <ErrorState message={error} /> : null}

      {runs.length > 0 ? (
        <Card className="p-3">
          <p className="px-1 pb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            History
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {runs.map((run) => (
              <button
                key={run.id}
                type="button"
                disabled={!run.report}
                onClick={() => setSelectedId(run.id)}
                className={`min-w-48 rounded-lg border px-3 py-2 text-left text-xs transition-colors disabled:opacity-60 ${
                  selectedId === run.id
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <span className="block font-medium">{formatDate(run.createdAt)}</span>
                <span className={selectedId === run.id ? "text-slate-300" : "text-slate-500"}>
                  {run.report
                    ? `${run.report.period.start} – ${run.report.period.end}`
                    : `${run.status}: ${run.errorMessage ?? "No report output"}`}
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
          title="No weekly report yet"
          description="Generate a report after adding approved project work. Empty projects are rejected before any model call."
        />
      )}
    </div>
  );
}
