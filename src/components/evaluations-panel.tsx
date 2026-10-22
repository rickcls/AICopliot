"use client";

import { useCallback, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CHECKBOX,
  EmptyState,
  ErrorState,
  Input,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { useConfirm } from "@/components/confirm-dialog";
import { useDateLocale, useT, useTimeZone } from "@/components/i18n-provider";
import { useToast } from "@/components/toast";
import type { Metrics } from "@/lib/evaluation/scoring";
import { formatDate } from "@/lib/utils";

interface EvaluationRow {
  id: string;
  question: string;
  groundingScope: "documents" | "project_combined";
  expectedAnswerNotes: string | null;
  expectedKeywords: string[];
  shouldRefuse: boolean;
  actualAnswer: string | null;
  retrievedChunkIds: string[] | null;
  confidence: "high" | "medium" | "low" | null;
  latencyMs: number | null;
  modelName: string | null;
  citationCount: number;
  refused: boolean;
  autoScore: boolean | null;
  projectId: string | null;
  project: { name: string } | null;
  result: "pass" | "fail" | "unreviewed";
  createdAt: string;
}

const RESULT_TONE = {
  pass: "success",
  fail: "danger",
  unreviewed: "neutral",
} as const;

function pct(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function MetricsSummary({ metrics }: { metrics: Metrics }) {
  const t = useT();
  const tiles = [
    {
      label: t("evaluations.metrics.autoPass"),
      value: pct(metrics.autoPassRate),
      hint: t("evaluations.metrics.autoPassHint", {
        scored: metrics.scored,
        total: metrics.total,
      }),
    },
    {
      label: t("evaluations.metrics.refusal"),
      value: pct(metrics.refusalAccuracy),
      hint: t("evaluations.metrics.refusalHint", { count: metrics.refusalCases }),
    },
    {
      label: t("evaluations.metrics.citation"),
      value: pct(metrics.citationRate),
      hint: t("evaluations.metrics.citationHint"),
    },
    {
      label: t("evaluations.metrics.latency"),
      value:
        metrics.p95LatencyMs === null
          ? "—"
          : `${(metrics.p95LatencyMs / 1000).toFixed(1)}s`,
      hint:
        metrics.medianLatencyMs === null
          ? t("evaluations.metrics.noRuns")
          : t("evaluations.metrics.median", {
              seconds: (metrics.medianLatencyMs / 1000).toFixed(1),
            }),
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((tile) => (
        <Card key={tile.label} className="p-4">
          <p className="text-xs text-sand-500">{tile.label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{tile.value}</p>
          <p className="mt-0.5 text-xs text-sand-400">{tile.hint}</p>
        </Card>
      ))}
    </div>
  );
}

export function EvaluationsPanel({
  initialEvaluations,
  initialMetrics,
  projects,
}: {
  initialEvaluations: EvaluationRow[];
  initialMetrics: Metrics;
  projects: Array<{ id: string; name: string }>;
}) {
  const [rows, setRows] = useState<EvaluationRow[]>(initialEvaluations);
  const [metrics, setMetrics] = useState<Metrics>(initialMetrics);
  const [question, setQuestion] = useState("");
  const [notes, setNotes] = useState("");
  const [keywords, setKeywords] = useState("");
  const [shouldRefuse, setShouldRefuse] = useState(false);
  const [running, setRunning] = useState(false);
  const [runningAll, setRunningAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();
  const toast = useToast();
  const t = useT();
  const dateLocale = useDateLocale();
  const timeZone = useTimeZone();
  const [projectId, setProjectId] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/evaluations");
      if (!response.ok) throw new Error(t("evaluations.loadFailed"));
      const data = await response.json();
      setRows(data.evaluations);
      setMetrics(data.metrics);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [t]);

  async function handleRun(event: React.FormEvent) {
    event.preventDefault();
    if (question.trim().length < 3 || running) return;

    setRunning(true);
    setError(null);

    try {
      const response = await fetch("/api/evaluations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: question.trim(),
          expectedAnswerNotes: notes.trim() || undefined,
          expectedKeywords: keywords
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean),
          shouldRefuse,
          projectId: projectId || null,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error ?? t("evaluations.runFailed"));
        return;
      }

      setQuestion("");
      setNotes("");
      setKeywords("");
      setShouldRefuse(false);
      await load();
    } catch {
      setError(t("common.couldNotReach"));
    } finally {
      setRunning(false);
    }
  }

  async function handleRunAll() {
    if (runningAll || rows.length === 0) return;
    const confirmed = await confirm({
      title: t("evaluations.rerunTitle", { count: rows.length }),
      body: t("evaluations.rerunBody"),
      confirmLabel: t("evaluations.rerunConfirm"),
    });
    if (!confirmed) return;

    setRunningAll(true);
    setError(null);

    try {
      const response = await fetch("/api/evaluations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run-all" }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error ?? t("evaluations.rerunFailed"));
        return;
      }

      setRows(data.evaluations);
      setMetrics(data.metrics);
      toast.success(
        t("evaluations.reran", { count: data.evaluations.length }),
        t("evaluations.reranHint"),
      );
    } catch {
      setError(t("common.couldNotReach"));
    } finally {
      setRunningAll(false);
    }
  }

  async function review(id: string, result: "pass" | "fail") {
    const response = await fetch("/api/evaluations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, result }),
    }).catch(() => null);

    if (response?.ok) {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, result } : r)));
    } else {
      setError(t("evaluations.reviewFailed"));
    }
  }

  async function remove(id: string) {
    const confirmed = await confirm({
      title: t("evaluations.deleteTitle"),
      body: t("evaluations.deleteBody"),
      confirmLabel: t("evaluations.deleteConfirm"),
      tone: "danger",
    });
    if (!confirmed) return;

    const response = await fetch(`/api/evaluations?id=${id}`, {
      method: "DELETE",
    }).catch(() => null);

    if (response?.ok) {
      await load();
      toast.success(t("evaluations.deleted"));
    } else {
      setError(t("evaluations.deleteFailed"));
    }
  }

  return (
    <div className="space-y-6">
      <MetricsSummary metrics={metrics} />

      <Card className="p-4">
        <form onSubmit={handleRun} className="space-y-3">
          <div>
            <label htmlFor="eval-project" className="mb-1.5 block text-sm font-medium">
              {t("evaluations.scope")}
            </label>
            <Select
              id="eval-project"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              disabled={running}
              className="w-full"
            >
              <option value="">{t("evaluations.allDocuments")}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {t("evaluations.projectScope", { name: project.name })}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="eval-question" className="mb-1.5 block text-sm font-medium">
              {t("evaluations.question")}
            </label>
            <Input
              id="eval-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={t("evaluations.questionPlaceholder")}
              disabled={running}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="eval-keywords" className="mb-1.5 block text-sm font-medium">
                {t("evaluations.keywords")}{" "}
                <span className="font-normal text-sand-500">
                  {t("evaluations.keywordsHint")}
                </span>
              </label>
              <Input
                id="eval-keywords"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder={t("evaluations.keywordsPlaceholder")}
                disabled={running || shouldRefuse}
              />
              <p className="mt-1.5 text-xs text-sand-500">
                {t("evaluations.keywordsRule")}
              </p>
            </div>

            <div>
              <span className="mb-1.5 block text-sm font-medium">
                {t("evaluations.expectation")}
              </span>
              <label className="flex items-center gap-2 rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={shouldRefuse}
                  onChange={(e) => setShouldRefuse(e.target.checked)}
                  disabled={running}
                  className={CHECKBOX}
                />
                {t("evaluations.shouldRefuse")}
              </label>
              <p className="mt-1.5 text-xs text-sand-500">
                {t("evaluations.shouldRefuseRule")}
              </p>
            </div>
          </div>

          <div>
            <label htmlFor="eval-notes" className="mb-1.5 block text-sm font-medium">
              {t("evaluations.notes")}{" "}
              <span className="font-normal text-sand-500">{t("evaluations.optional")}</span>
            </label>
            <Textarea
              id="eval-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("evaluations.notesPlaceholder")}
              disabled={running}
            />
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={handleRunAll}
              disabled={runningAll || running || rows.length === 0}
            >
              {runningAll ? (
                <>
                  <Spinner />
                  {t("evaluations.rerunning", { count: rows.length })}
                </>
              ) : (
                t("evaluations.rerunAll", { count: rows.length })
              )}
            </Button>
            <Button type="submit" disabled={running || question.trim().length < 3}>
              {running ? (
                <>
                  <Spinner inverse />
                  {t("evaluations.running")}
                </>
              ) : (
                t("evaluations.addRun")
              )}
            </Button>
          </div>
        </form>
      </Card>

      {error ? <ErrorState message={error} /> : null}

      {rows.length === 0 ? (
        <EmptyState
          title={t("evaluations.emptyTitle")}
          description={t("evaluations.emptyBody")}
        />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <Card key={row.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="text-sm font-medium">{row.question}</p>
                <div className="flex items-center gap-2">
                  {row.shouldRefuse ? (
                    <Badge tone="info">{t("evaluations.expectsRefusal")}</Badge>
                  ) : null}
                  {row.autoScore !== null ? (
                    <Badge tone={row.autoScore ? "success" : "danger"}>
                      {row.autoScore
                        ? t("evaluations.autoPassBadge")
                        : t("evaluations.autoFailBadge")}
                    </Badge>
                  ) : (
                    <Badge tone={RESULT_TONE[row.result]}>
                      {t(`evaluations.results.${row.result}`)}
                    </Badge>
                  )}
                </div>
              </div>

              <p className="mt-1 text-xs text-sand-500">
                {[
                  formatDate(row.createdAt, dateLocale, timeZone),
                  row.modelName,
                  row.project?.name ?? t("evaluations.allDocumentsShort"),
                  row.groundingScope === "project_combined"
                    ? t("evaluations.combined")
                    : t("evaluations.documentGrounding"),
                  row.latencyMs !== null ? `${(row.latencyMs / 1000).toFixed(1)}s` : null,
                  row.confidence ? t(`confidence.${row.confidence}`) : null,
                  t("evaluations.citations", { count: row.citationCount }),
                  row.retrievedChunkIds
                    ? t("evaluations.chunks", { count: row.retrievedChunkIds.length })
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>

              {row.expectedKeywords.length > 0 ? (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-sand-500">{t("evaluations.expects")}</span>
                  {row.expectedKeywords.map((keyword) => {
                    const found = (row.actualAnswer ?? "")
                      .toLowerCase()
                      .includes(keyword.toLowerCase());
                    return (
                      <Badge key={keyword} tone={found ? "success" : "danger"}>
                        {keyword}
                      </Badge>
                    );
                  })}
                </div>
              ) : null}

              {row.expectedAnswerNotes ? (
                <div className="mt-3">
                  <h3 className="text-xs font-semibold text-sand-500 uppercase">
                    {t("evaluations.notesHeading")}
                  </h3>
                  <p className="mt-1 text-sm text-pretty text-sand-600">
                    {row.expectedAnswerNotes}
                  </p>
                </div>
              ) : null}

              <div className="mt-3">
                <h3 className="text-xs font-semibold text-sand-500 uppercase">
                  {t("evaluations.actual")}
                </h3>
                <p className="mt-1 text-sm whitespace-pre-wrap text-pretty text-sand-700">
                  {row.actualAnswer ?? "—"}
                </p>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-sand-100 pt-4">
                <span className="text-xs text-sand-500">
                  {row.autoScore !== null ? t("evaluations.override") : t("evaluations.markAs")}
                </span>
                <Button
                  size="sm"
                  variant={row.result === "pass" ? "secondary" : "ghost"}
                  aria-pressed={row.result === "pass"}
                  onClick={() => review(row.id, "pass")}
                >
                  {t("evaluations.pass")}
                </Button>
                <Button
                  size="sm"
                  variant={row.result === "fail" ? "secondary" : "ghost"}
                  aria-pressed={row.result === "fail"}
                  onClick={() => review(row.id, "fail")}
                >
                  {t("evaluations.fail")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto text-red-600 hover:bg-red-50"
                  onClick={() => remove(row.id)}
                >
                  {t("common.delete")}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
